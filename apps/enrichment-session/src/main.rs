mod config;
mod consumer;
mod enricher;
mod health;
#[path = "idempotency.rs"]
mod window;
mod session;
mod customer;
mod trigger_forwarder;
mod metrics;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use envconfig::Envconfig;
use tracing::{error, info};

use config::AppConfig;
use consumer::{EnrichmentConsumer, SharedConsumerState};
use enricher::Enricher;
use health::HealthServer;
use window::WindowService;
use metrics::EnrichmentMetrics;
use redis::Client as RedisClient;
use rust_postgre_client::{MetricsHandle, PostgresClient, PostgresConfig};
use session::SessionService;
use customer::CustomerService;
use trigger_forwarder::TriggerForwarder;

#[tokio::main]
async fn main() {
    let config = AppConfig::init_from_env().unwrap_or_else(|e| {
        eprintln!("Configuration error: {e}");
        std::process::exit(1);
    });

    std::env::set_var("RUST_LOG", config.log_level.clone());
    tracing_subscriber::fmt::init();

    info!(
        port = config.port,
        brokers = %config.kafka_brokers,
        "Starting enrichment-session service"
    );

    let prometheus_handle = metrics::setup_metrics_recorder();

    let redis = Arc::new(RedisClient::open(config.redis_url.as_str()).unwrap_or_else(|e| {
        error!("Invalid Redis URL: {e}");
        std::process::exit(1);
    }));

    let metrics = Arc::new(EnrichmentMetrics::new());

    // PostgreSQL client with Prometheus-backed metrics
    let pg_config = PostgresConfig::new(&config.postgres_url).unwrap_or_else(|e| {
        error!("Invalid database URL: {e}");
        std::process::exit(1);
    });
    let pg_metrics = MetricsHandle::new((*metrics).clone());
    let db = Arc::new(
        PostgresClient::with_metrics(pg_config, pg_metrics)
            .await
            .unwrap_or_else(|e| {
                error!("Failed to create PostgresClient: {e}");
                std::process::exit(1);
            }),
    );

    let window_service = Arc::new(WindowService::new(
        redis.clone(),
        config.session_window_ttl_seconds,
        config.session_ttl_seconds,
        config.idempotency_ttl_seconds,
        config.ewma_alpha,
        metrics.clone(),
    ));
    let session = Arc::new(SessionService::new(redis.clone(), config.session_ttl_seconds));
    let customer = Arc::new(CustomerService::new(redis.clone(), db.clone(), metrics.clone()));
    let enricher = Arc::new(Enricher::new(
        window_service.clone(),
        session.clone(),
        customer.clone(),
        metrics.clone(),
    ));
    let trigger_forwarder = TriggerForwarder::new(
        config.decision_engine_url.clone(),
        config.internal_secret.clone(),
    );

    let consumer_state = SharedConsumerState::default();
    let shutdown_flag = Arc::new(AtomicBool::new(false));

    let mut consumer = EnrichmentConsumer::new(
        config.clone(),
        enricher.clone(),
        metrics.clone(),
        Some(Arc::new(trigger_forwarder)),
        consumer_state.clone(),
        shutdown_flag.clone(),
    );

    let health_server = HealthServer::new(
        prometheus_handle,
        config.port,
        consumer_state,
        redis,
        db,
    );

    health_server.start();

    // Spawn signal handler — sets the atomic flag to break the consumer loop
    // after the current message completes (graceful drain).
    let flag = shutdown_flag.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        flag.store(true, Ordering::Release);
        info!("Shutdown flag set — consumer will stop after current message");
    });

    if let Err(e) = consumer.start().await {
        error!(error = %e, "Enrichment consumer stopped unexpectedly");
        std::process::exit(1);
    }

    info!("Enrichment consumer shut down gracefully");
}

/// Resolves on SIGTERM (Unix) or SIGINT (Ctrl-C on all platforms).
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate())
            .expect("Failed to register SIGTERM handler");
        tokio::select! {
            _ = sigterm.recv() => info!("SIGTERM received"),
            _ = tokio::signal::ctrl_c() => info!("SIGINT received"),
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to listen for ctrl-c");
        info!("SIGINT received");
    }
}
