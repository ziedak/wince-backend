use std::sync::Arc;
use axum::{Router, routing::get};
use tracing::info;
use crate::metrics::EnrichmentMetrics;

pub struct HealthServer {
    metrics: Arc<EnrichmentMetrics>,
    port: u16,
}

impl HealthServer {
    pub fn new(metrics: Arc<EnrichmentMetrics>, port: u16) -> Self {
        Self { metrics, port }
    }

    pub fn start(&self) {
        let app = Router::new()
            .route("/live", get(|| async { "ok" }))
            .route("/ready", get(|| async { "ready" }))
            .route("/metrics", get(|| async { "metrics" }));

        let port = self.port;
        tokio::spawn(async move {
            let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
                .await
                .expect("Failed to bind health server");
            info!("Health server listening on port {}", port);
            axum::serve(listener, app).await.ok();
        });
    }

    pub async fn stop(&self) {
        // TODO: implement graceful shutdown
    }
}