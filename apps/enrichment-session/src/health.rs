use std::sync::Arc;
use axum::{Router, routing::get};
use rust_shared_metrics::setup_metrics_recorder;
use tracing::info;
use crate::metrics::EnrichmentMetrics;
use crate::consumer::ConsumerState;

pub struct HealthServer {
    metrics: Arc<EnrichmentMetrics>,
    port: u16,
}

impl HealthServer {
    pub fn new(metrics: Arc<EnrichmentMetrics>, port: u16) -> Self {
        Self { metrics, port }
    }

    pub fn start(&self) {
        let metrics = self.metrics.clone();
        
        let app = Router::new()
            .route("/live", get(|| async { "ok" }))
            .route("/ready", get(|| async { "ready" }))
            .route("/metrics", get(move || {
                let metrics = metrics.clone();
                async move {
                    // TODO: implement metrics endpoint properly
                    "metrics"
                }
            }));

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