mod config;
mod consumer;
mod enricher;
mod health;
mod idempotency;
mod session;
mod customer;
mod trigger_forwarder;
mod metrics;

use std::sync::Arc;
use tracing::{error, info};

use config::AppConfig;
use consumer::EnrichmentConsumer;
use enricher::Enricher;
use health::HealthServer;
use idempotency::IdempotencyService;
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

    let idempotency = Arc::new(IdempotencyService::new(
        redis.clone(),
        metrics.clone(),
        config.bloom_filter_key.clone(),
    ));
    let session = Arc::new(SessionService::new(redis.clone(), config.session_ttl_seconds, metrics.clone()));
    let customer = Arc::new(CustomerService::new(
        redis.clone(),
        db,
        metrics.clone(),
    ));
    let enricher = Arc::new(Enricher::new(
        idempotency.clone(),
        session.clone(),
        customer.clone(),
        metrics.clone(),
    ));
    let trigger_forwarder = TriggerForwarder::new(
        config.decision_engine_url.clone(),
        config.internal_secret.clone(),
    );
    let consumer = EnrichmentConsumer::new(
        config.clone(),
        enricher.clone(),
        idempotency.clone(),
        metrics.clone(),
        Some(Arc::new(trigger_forwarder)),
    );
    let health_server = HealthServer::new(metrics.clone(), config.port);

    let shutdown = async {
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to listen for ctrl-c");
        info!("Shutdown signal received");
    };

    health_server.start();
    consumer.start().await;
    let _ = shutdown;
}