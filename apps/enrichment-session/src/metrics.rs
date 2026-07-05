use std::sync::Arc;
use std::time::Instant;
use metrics::{counter, histogram, gauge};
use rust_postgre_client::QueryMetricsRecorder;
use rust_shared_metrics::setup_metrics_recorder;

/// Enrichment-specific Prometheus metrics wrapper.
///
/// Also implements [`QueryMetricsRecorder`] so it can be passed to
/// [`PostgresClient::with_metrics`](rust_postgre_client::PostgresClient::with_metrics).
#[derive(Clone)]
pub struct EnrichmentMetrics {
    _inner: Arc<()>,
}

impl EnrichmentMetrics {
    /// Creates a new metrics instance. Call `setup_metrics_recorder()` once at
    /// startup before creating this wrapper.
    pub fn new() -> Self {
        Self { _inner: Arc::new(()) }
    }

    #[inline]
    pub fn events_processed(&self, status: &str) {
        counter!("enrichment_events_processed_total", "status" => status.to_string()).increment(1);
    }

    #[inline]
    pub fn processing_latency(&self, ms: f64) {
        histogram!("enrichment_processing_latency_seconds").record(ms / 1000.0);
    }

    #[inline]
    pub fn db_query_latency(&self, operation: &str, ms: f64) {
        histogram!("enrichment_db_query_latency_seconds", "operation" => operation.to_string()).record(ms / 1000.0);
    }

    #[inline]
    pub fn kafka_lag(&self, partition: i32, lag: i64) {
        gauge!("enrichment_kafka_lag", "partition" => partition.to_string()).set(lag as f64);
    }

    #[inline]
    pub fn bloom_false_positive(&self) {
        counter!("enrichment_redis_bloom_false_positive").increment(1);
    }
}

// ---------------------------------------------------------------------------
// Implement the pluggable QueryMetricsRecorder trait from rust-postgre_client
// ---------------------------------------------------------------------------

impl QueryMetricsRecorder for EnrichmentMetrics {
    fn record_query(&self, latency_seconds: f64, success: bool) {
        let status = if success { "ok" } else { "error" };
        histogram!("postgres_query_latency_seconds").record(latency_seconds);
        counter!("postgres_queries_total", "status" => status.to_string()).increment(1);
    }

    fn record_circuit_breaker_trip(&self) {
        counter!("postgres_circuit_breaker_trips_total").increment(1);
    }
}