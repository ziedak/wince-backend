mod config;
mod errors;
mod handler;
mod health;
mod kafka;
mod metrics;
mod pipeline;
mod rate_limiter;
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

    // ─── Tracing ──────────────────────────────────────────────────────────────
    let filter = EnvFilter::try_new(config.log_level.clone())
        .unwrap_or_else(|_| EnvFilter::new("info"));

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!(port = config.port, brokers = %config.kafka_hosts, "Starting ingestion service");

    // ─── Phase 1: Prometheus metrics recorder ─────────────────────────────────
    let prometheus_handle = metrics::setup_metrics_recorder();

    // ─── Health handle ────────────────────────────────────────────────────────
    let health = HealthHandle::new();

    // ─── Kafka producer ───────────────────────────────────────────────────────
    let producer = kafka::create_producer(&config, health.clone()).unwrap_or_else(|e| {
        error!("Failed to create Kafka producer: {e}");
        std::process::exit(1);
    });

    // ─── Phase 6: Sink (Kafka or Kafka + S3 fallback) ─────────────────────────
    let sink: Arc<dyn sinks::Sink> = if config.s3_fallback_enabled {
        let bucket = config.s3_fallback_bucket.clone().unwrap_or_else(|| {
            error!("S3_FALLBACK_ENABLED=true but S3_FALLBACK_BUCKET is not set");
            std::process::exit(1);
        });
        let s3_sink = sinks::s3::S3Sink::new(
            bucket,
            config.s3_endpoint_url.clone(),
            config.s3_region.clone(),
        )
        .await
        .unwrap_or_else(|e| {
            error!("Failed to create S3 fallback sink: {e}");
            std::process::exit(1);
        });
        info!("S3 fallback sink enabled");
        Arc::new(sinks::fallback::FallbackSink::new(
            Arc::new(sinks::kafka::KafkaSink::new(producer)),
            Arc::new(s3_sink),
        ))
    } else {
        Arc::new(sinks::kafka::KafkaSink::new(producer))
    };

    // ─── Redis client ─────────────────────────────────────────────────────────
    let redis_client = redis::Client::open(config.redis_url.as_str()).unwrap_or_else(|e| {
        error!("Invalid Redis URL: {e}");
        std::process::exit(1);
    });

    // ─── Phase 3: Per-store rate limiter ──────────────────────────────────────
    let store_limiter = Arc::new(rate_limiter::StoreLimiter::new(
        NonZeroU32::new(config.rate_limit_per_second.max(1)).unwrap(),
        NonZeroU32::new(config.rate_limit_burst.max(1)).unwrap(),
        config.rate_limit_enabled,
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
    ));
    if config.overflow_enabled {
        info!(
            per_second = config.overflow_per_second,
            burst = config.overflow_burst,
            "Hot-partition overflow limiter enabled"
        );
    }

    // ─── Shared state ─────────────────────────────────────────────────────────
    let state = AppState {
        config: Arc::new(config.clone()),
        sink,
        redis: Arc::new(redis_client),
        store_limiter,
        overflow_limiter,
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


