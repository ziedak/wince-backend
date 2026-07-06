use std::sync::Arc;
use std::sync::atomic::Ordering;
use axum::{extract::State, http::StatusCode, routing::get, Router};
use metrics_exporter_prometheus::PrometheusHandle;
use tracing::info;

use crate::consumer::SharedConsumerState;
use rust_postgre_client::PostgresClient;
use rust_redis_client::RedisClient;

#[derive(Clone)]
struct HealthState {
    prometheus_handle: PrometheusHandle,
    consumer_state: SharedConsumerState,
    redis: Arc<RedisClient>,
    db: Arc<PostgresClient>,
}

pub struct HealthServer {
    inner: HealthState,
    port: u16,
}

impl HealthServer {
    pub fn new(
        prometheus_handle: PrometheusHandle,
        port: u16,
        consumer_state: SharedConsumerState,
        redis: Arc<RedisClient>,
        db: Arc<PostgresClient>,
    ) -> Self {
        Self {
            inner: HealthState { prometheus_handle, consumer_state, redis, db },
            port,
        }
    }

    pub fn start(&self) {
        let state = self.inner.clone();
        let port = self.port;
        let app = Router::new()
            .route("/live", get(|| async { "ok" }))
            .route("/ready", get(ready_handler))
            .route("/metrics", get(metrics_handler))
            .with_state(state);

        tokio::spawn(async move {
            let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
                .await
                .expect("Failed to bind health server");
            info!("Health server listening on port {}", port);
            axum::serve(listener, app).await.ok();
        });
    }
}

async fn ready_handler(State(s): State<HealthState>) -> (StatusCode, &'static str) {
    // Consumer must be subscribed and not in back-off
    if !s.consumer_state.subscribed.load(Ordering::Relaxed)
        || s.consumer_state.backing_off.load(Ordering::Relaxed)
    {
        return (StatusCode::SERVICE_UNAVAILABLE, "not ready");
    }

    // Verify Redis connectivity
    let redis_ok = s.redis.is_healthy().await;

    // Verify DB connectivity (uses pooled connection, very cheap)
    let db_ok = s.db.health_check().await.is_ok();

    if redis_ok && db_ok {
        (StatusCode::OK, "ready")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "not ready")
    }
}

async fn metrics_handler(State(s): State<HealthState>) -> (StatusCode, String) {
    (StatusCode::OK, s.prometheus_handle.render())
}
