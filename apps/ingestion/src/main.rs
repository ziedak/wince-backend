mod body;
mod config;
mod decompression;
mod errors;
mod handler;
mod health;
mod kafka;
mod metrics;
mod pipeline;
mod quota_limiter;
mod rate_limiter;
mod response;
mod restrictions;
mod sinks;

use axum::{
    routing::{get, post},
    Router,
};
use envconfig::Envconfig;
use handler::AppState;
use health::{liveness_handler, readiness_handler, set_shutdown_status, HealthHandle, ShutdownStatus};
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() {
    // ─── Config ───────────────────────────────────────────────────────────────
    let config = config::AppConfig::init_from_env().unwrap_or_else(|e| {
        eprintln!("Configuration error: {e}");
        std::process::exit(1);
    });

    // ─── Tracing + optional OTLP ──────────────────────────────────────────────
    let filter = EnvFilter::try_new(config.log_level.clone())
        .unwrap_or_else(|_| EnvFilter::new("info"));

    let otel_layer = config.otel_exporter_otlp_endpoint.as_deref().and_then(|endpoint| {
        match init_otlp_tracer(&config.otel_service_name, endpoint, config.otel_sample_ratio) {
            Ok(tracer) => {
                eprintln!("OTLP: exporter connected to {endpoint}");
                Some(tracing_opentelemetry::layer().with_tracer(tracer))
            }
            Err(e) => {
                eprintln!("OTLP: tracer init failed — starting without: {e}");
                None
            }
        }
    });

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().json())
        .with(otel_layer)
        .init();

    info!(
        port = config.port,
        brokers = %config.kafka_hosts,
        otel = config.otel_exporter_otlp_endpoint.is_some(),
        "Starting ingestion service"
    );

    // ─── Phase 1: Prometheus metrics recorder ─────────────────────────────────
    let prometheus_handle = metrics::try_setup_metrics_recorder(metrics::ingestion_metrics_recorder_config())
        .unwrap_or_else(|e| {
            error!(error = %e, "Failed to install Prometheus metrics recorder");
            std::process::exit(1);
        });

    // ─── Health handle ────────────────────────────────────────────────────────
    let health = HealthHandle::new();

    // ─── Kafka producer ───────────────────────────────────────────────────────
    let producer = kafka::create_producer(&config, health.clone()).unwrap_or_else(|e| {
        error!("Failed to create Kafka producer: {e}");
        std::process::exit(1);
    });
    // Retained for graceful drain on shutdown; the sink moves the original handle.
    let producer_for_drain = producer.clone();

    // ─── Phase 6: Sink (Kafka or Kafka + S3 fallback) ─────────────────────────
    let sink: Arc<dyn sinks::Sink> = if config.s3_fallback_enabled {
        let bucket = config.s3_fallback_bucket.clone().unwrap_or_else(|| {
            error!("S3_FALLBACK_ENABLED=true but S3_FALLBACK_BUCKET is not set");
            std::process::exit(1);
        });
        // Provide WAL path only when WAL is enabled (default: true).
        let wal_path = if config.wal_enabled {
            Some(config.wal_db_path.clone())
        } else {
            None
        };
        let s3_sink = sinks::s3::S3Sink::new_with_wal(
            bucket,
            config.s3_endpoint_url.clone(),
            config.s3_region.clone(),
            wal_path,
        )
        .await
        .unwrap_or_else(|e| {
            error!("Failed to create S3 fallback sink: {e}");
            std::process::exit(1);
        });
        info!(
            wal_enabled = config.wal_enabled,
            advisory_enabled = config.advisory_fallback_enabled,
            "S3 fallback sink enabled"
        );
        Arc::new(sinks::fallback::FallbackSink::new_with_health(
            Arc::new(sinks::kafka::KafkaSink::new(producer)),
            Arc::new(s3_sink),
            health.clone(),
            config.advisory_fallback_enabled,
            config.kafka_health_threshold_ms,
        ))
    } else {
        Arc::new(sinks::kafka::KafkaSink::new(producer))
    };

    // ─── Redis client ─────────────────────────────────────────────────────────
    let redis_client = Arc::new(redis::Client::open(config.redis_url.as_str()).unwrap_or_else(|e| {
        error!("Invalid Redis URL: {e}");
        std::process::exit(1);
    }));

    // ─── Phase 3: Per-store rate limiter ──────────────────────────────────────
    let store_limiter = Arc::new(rate_limiter::StoreLimiter::new(
        NonZeroU32::new(config.rate_limit_per_second.max(1)).unwrap(),
        NonZeroU32::new(config.rate_limit_burst.max(1)).unwrap(),
        config.rate_limit_enabled,
        config.rate_limit_dry_run,
    ));
    if config.rate_limit_enabled {
        info!(
            per_second = config.rate_limit_per_second,
            burst = config.rate_limit_burst,
            "Per-store rate limiter enabled"
        );
    }

    // ─── Phase 5: Overflow limiter ────────────────────────────────────────────
    let overflow_limiter = Arc::new(rate_limiter::OverflowLimiter::new(
        NonZeroU32::new(config.overflow_per_second.max(1)).unwrap(),
        NonZeroU32::new(config.overflow_burst.max(1)).unwrap(),
        config.overflow_enabled,
        config.overflow_dry_run,
    ));
    if config.overflow_enabled {
        info!(
            per_second = config.overflow_per_second,
            burst = config.overflow_burst,
            "Hot-partition overflow limiter enabled"
        );
    }

    // ─── Phase 4: Distributed rate limiter ───────────────────────────────────────
    let dist_limiter: Option<Arc<rate_limiter::DistributedStoreLimiter>> =
        if config.distributed_rate_limit_enabled {
            info!(
                per_second = config.distributed_rate_limit_per_second,
                dry_run = config.distributed_rate_limit_dry_run,
                "Distributed rate limiter enabled"
            );
            Some(Arc::new(rate_limiter::DistributedStoreLimiter::new(
                Arc::clone(&redis_client),
                config.distributed_rate_limit_per_second,
                true,
                config.distributed_rate_limit_dry_run,
            )))
        } else {
            None
        };

    // ─── Phase 5: Quota limiter ────────────────────────────────────────────
    let quota_limiter = Arc::new(quota_limiter::QuotaLimiter::new(
        config.quota_limiter_enabled,
    ));
    if config.quota_limiter_enabled {
        info!(
            refresh_interval_s = config.quota_refresh_interval_s,
            "Quota limiter enabled"
        );
        quota_limiter::spawn_refresh_loop(
            Arc::clone(&quota_limiter),
            Arc::clone(&redis_client),
            config.quota_refresh_interval_s,
        );
    }

    // ─── Phase 6: Event restriction store ──────────────────────────────────
    let restriction_store = Arc::new(restrictions::RestrictionStore::new(
        config.restrictions_enabled,
    ));
    if config.restrictions_enabled {
        info!(
            refresh_interval_s = config.restrictions_refresh_interval_s,
            "Event restriction store enabled"
        );
        restrictions::spawn_refresh_loop(
            Arc::clone(&restriction_store),
            Arc::clone(&redis_client),
            config.restrictions_refresh_interval_s,
        );
    }

    // ─── Shared state ───────────────────────────────────────────────────────────
    let state = AppState {
        config: Arc::new(config.clone()),
        sink,
        redis: redis_client,
        store_limiter,
        overflow_limiter,
        dist_limiter,
        quota_limiter,
        restriction_store,
    };
    let port = state.config.port;

    // ─── Router ───────────────────────────────────────────────────────────────
    // Phase 1: /metrics endpoint
    // Phase 8: TimeoutLayer limits total request time to guard against slow clients
    let request_timeout = Duration::from_millis(config.http_request_timeout_ms);

    let app = Router::new()
        .route("/v1/track", post(handler::track_handler))
        .route("/live", get(liveness_handler))
        .route("/ready", get(readiness_handler))
        .route(
            "/metrics",
            get(move || {
                let handle = prometheus_handle.clone();
                async move { handle.render() }
            }),
        )
        .layer(TimeoutLayer::new(request_timeout))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    // Phase 8: tcp_nodelay(true) disables Nagle's algorithm so small responses
    // are sent immediately without waiting for more data to accumulate.
    let listener = TcpListener::bind(addr).await.unwrap_or_else(|e| {
        error!("Failed to bind to {addr}: {e}");
        std::process::exit(1);
    });

    info!(addr = %addr, "Listening");

    axum::serve(listener, app)
        .tcp_nodelay(true)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap_or_else(|e| error!("Server error: {e}"));

    // ─── Graceful drain ───────────────────────────────────────────────────────
    info!(
        timeout_secs = config.kafka_drain_timeout_secs,
        "Draining Kafka producer..."
    );
    kafka::drain_producer(
        producer_for_drain,
        Duration::from_secs(config.kafka_drain_timeout_secs),
    )
    .await;

    if config.otel_exporter_otlp_endpoint.is_some() {
        opentelemetry::global::shutdown_tracer_provider();
    }

    set_shutdown_status(ShutdownStatus::Completed);
    info!("Shutdown complete");
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("Failed to listen for ctrl-c");
    info!("Shutdown signal received");
    set_shutdown_status(ShutdownStatus::Terminating);
}

/// Initialise the OTLP batch span exporter and register it as the global
/// tracer provider.  Returns the tracer to wire into the
/// `tracing-opentelemetry` subscriber layer.
///
/// Any error should be treated as non-fatal — callers log it and continue
/// with JSON-only logging.
fn init_otlp_tracer(
    service_name: &str,
    endpoint: &str,
    sample_ratio: f64,
) -> Result<opentelemetry_sdk::trace::Tracer, opentelemetry::trace::TraceError> {
    use opentelemetry::KeyValue;
    use opentelemetry_otlp::WithExportConfig;
    use opentelemetry_sdk::trace::Sampler;
    use opentelemetry_sdk::Resource;

    let sampler = if (1.0 - sample_ratio).abs() < 1e-9 {
        Sampler::AlwaysOn
    } else {
        Sampler::TraceIdRatioBased(sample_ratio)
    };

    opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(endpoint),
        )
        .with_trace_config(
            opentelemetry_sdk::trace::config()
                .with_sampler(sampler)
                .with_resource(Resource::new(vec![
                    KeyValue::new("service.name", service_name.to_owned()),
                    KeyValue::new("service.version", env!("CARGO_PKG_VERSION").to_owned()),
                ])),
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
}


