//! Prometheus metrics setup and helper functions.
//!
//! Call `setup_metrics_recorder()` once at startup before any metric macros
//! are invoked. The returned `PrometheusHandle` is mounted at `GET /metrics`.

use metrics_exporter_prometheus::{Matcher, PrometheusBuilder, PrometheusHandle};

pub fn setup_metrics_recorder() -> PrometheusHandle {
    const LATENCY_BUCKETS: &[f64] = &[
        0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0,
    ];
    const SIZE_BUCKETS: &[f64] = &[
        512.0,
        1_024.0,       // 1 KB
        4_096.0,       // 4 KB
        16_384.0,      // 16 KB
        65_536.0,      // 64 KB
        262_144.0,     // 256 KB
        1_048_576.0,   // 1 MB
        4_194_304.0,   // 4 MB
    ];
    const BATCH_BUCKETS: &[f64] = &[1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0];
    const SKEW_BUCKETS: &[f64] = &[1.0, 5.0, 10.0, 30.0, 60.0, 300.0, 1_800.0, 3_600.0];

    PrometheusBuilder::new()
        .set_buckets_for_metric(
            Matcher::Full("ingestion_produce_duration_seconds".into()),
            LATENCY_BUCKETS,
        )
        .expect("invalid latency buckets")
        .set_buckets_for_metric(
            Matcher::Full("ingestion_event_payload_bytes".into()),
            SIZE_BUCKETS,
        )
        .expect("invalid size buckets")
        .set_buckets_for_metric(
            Matcher::Full("ingestion_batch_size".into()),
            BATCH_BUCKETS,
        )
        .expect("invalid batch buckets")
        .set_buckets_for_metric(
            Matcher::Full("ingestion_clock_skew_seconds".into()),
            SKEW_BUCKETS,
        )
        .expect("invalid skew buckets")
        .install_recorder()
        .expect("failed to install Prometheus metrics recorder")
}

/// Increment the dropped-events counter with a machine-readable cause label.
///
/// Recognised causes: `invalid`, `duplicate`, `too_big`, `kafka_error`.
#[inline]
pub fn report_dropped_event(cause: &'static str) {
    metrics::counter!("ingestion_events_dropped_total", "cause" => cause).increment(1);
}
