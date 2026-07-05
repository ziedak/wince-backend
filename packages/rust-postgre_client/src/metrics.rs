//! Metrics trait for recording query-level observability.
//!
//! The library defines a [`QueryMetricsRecorder`] trait that consumers implement
//! with their chosen metrics backend (Prometheus, OpenTelemetry, etc.).
//! A [`NoopMetricsRecorder`] is provided for testing or when metrics are not needed.

use std::sync::Arc;

/// Interface for recording query-level metrics.
///
/// Implement this trait with your chosen metrics backend.
/// The trait is object-safe so it can be used as `Box<dyn QueryMetricsRecorder>`.
pub trait QueryMetricsRecorder: Send + Sync {
    /// Record a single query execution.
    ///
    /// * `latency_seconds` — wall-clock duration of the query.
    /// * `success` — whether the query completed without error.
    fn record_query(&self, latency_seconds: f64, success: bool);

    /// Record a circuit-breaker trip event.
    fn record_circuit_breaker_trip(&self);
}

/// A no-op recorder that discards all metrics.
///
/// Useful for tests or when observability is not required.
#[derive(Clone, Default)]
pub struct NoopMetricsRecorder;

impl QueryMetricsRecorder for NoopMetricsRecorder {
    fn record_query(&self, _latency_seconds: f64, _success: bool) {}
    fn record_circuit_breaker_trip(&self) {}
}

// ---------------------------------------------------------------------------
// Convenience wrapper — shared reference counting
// ---------------------------------------------------------------------------

/// Thread-safe, cloneable handle to a [`QueryMetricsRecorder`].
///
/// This is the type stored inside [`PostgresClient`](crate::PostgresClient).
#[derive(Clone)]
pub struct MetricsHandle {
    inner: Arc<dyn QueryMetricsRecorder>,
}

impl MetricsHandle {
    /// Wrap any [`QueryMetricsRecorder`] into a shared handle.
    pub fn new(recorder: impl QueryMetricsRecorder + 'static) -> Self {
        Self {
            inner: Arc::new(recorder),
        }
    }

    /// Wrap an already-`Arc`-wrapped recorder.
    pub fn from_arc(recorder: Arc<dyn QueryMetricsRecorder>) -> Self {
        Self { inner: recorder }
    }

    /// Delegate a query recording.
    pub fn record_query(&self, latency_seconds: f64, success: bool) {
        self.inner.record_query(latency_seconds, success);
    }

    /// Delegate a circuit-breaker trip.
    pub fn record_circuit_breaker_trip(&self) {
        self.inner.record_circuit_breaker_trip();
    }
}

impl Default for MetricsHandle {
    fn default() -> Self {
        Self {
            inner: Arc::new(NoopMetricsRecorder),
        }
    }
}
