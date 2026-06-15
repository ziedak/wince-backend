mod config;
mod errors;
mod handler;
mod health;
mod kafka;
mod pipeline;

use axum::{
    routing::{get, post},
    Router,
};
use envconfig::Envconfig;
use health::{liveness_handler, readiness_handler, set_shutdown_status, HealthHandle, ShutdownStatus};
use handler::AppState;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
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

    // ─── Health handle ────────────────────────────────────────────────────────
    // HealthHandle is zero-sized; it writes into the global KAFKA_HEALTHY atomic.
    let health = HealthHandle::new();

    // ─── Kafka producer ───────────────────────────────────────────────────────
    let producer = kafka::create_producer(&config, health.clone()).unwrap_or_else(|e| {
        error!("Failed to create Kafka producer: {e}");
        std::process::exit(1);
    });

    // ─── Redis client (connections are acquired per request) ──────────────────
    let redis_client = redis::Client::open(config.redis_url.as_str()).unwrap_or_else(|e| {
        error!("Invalid Redis URL: {e}");
        std::process::exit(1);
    });

    // ─── Shared state ─────────────────────────────────────────────────────────
    let state = AppState {
        config: Arc::new(config),
        producer: Arc::new(producer),
        redis: Arc::new(redis_client),
    };
    let port = state.config.port;

    // ─── Router ───────────────────────────────────────────────────────────────
    let app = Router::new()
        .route("/v1/track", post(handler::track_handler))
        .route("/live", get(liveness_handler))
        .route("/ready", get(readiness_handler))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await.unwrap_or_else(|e| {
        error!("Failed to bind to {addr}: {e}");
        std::process::exit(1);
    });

    info!(addr = %addr, "Listening");

    axum::serve(listener, app)
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

