//! Shared Prometheus metrics helpers for Rust apps.
//!
//! This crate centralizes Prometheus recorder installation and generic bucket
//! configuration so each service can define its own metric names at the app
//! layer.

use metrics_exporter_prometheus::{BuildError, Matcher, PrometheusBuilder, PrometheusHandle};

pub type MetricsSetupError = BuildError;

pub const DEFAULT_LATENCY_BUCKETS: &[f64] = &[
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0,
];
pub const DEFAULT_SIZE_BUCKETS: &[f64] = &[
    512.0,
    1_024.0,
    4_096.0,
    16_384.0,
    65_536.0,
    262_144.0,
    1_048_576.0,
    4_194_304.0,
];
pub const DEFAULT_BATCH_BUCKETS: &[f64] = &[1.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0];
pub const DEFAULT_SKEW_BUCKETS: &[f64] = &[1.0, 5.0, 10.0, 30.0, 60.0, 300.0, 1_800.0, 3_600.0];
pub const DEFAULT_QUERY_LATENCY_BUCKETS: &[f64] = &[
    0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0,
];

#[derive(Clone, Copy, Debug)]
pub struct HistogramBuckets {
    pub metric_name: &'static str,
    pub buckets: &'static [f64],
}

#[derive(Clone, Copy, Debug)]
pub struct MetricsRecorderConfig {
    pub histogram_buckets: &'static [HistogramBuckets],
}

impl Default for MetricsRecorderConfig {
    fn default() -> Self {
        Self::empty()
    }
}

impl MetricsRecorderConfig {
    pub const fn new(histogram_buckets: &'static [HistogramBuckets]) -> Self {
        Self { histogram_buckets }
    }

    pub const fn empty() -> Self {
        Self {
            histogram_buckets: &[],
        }
    }
}

/// Install the Prometheus recorder with no preconfigured bucket overrides.
pub fn setup_metrics_recorder() -> PrometheusHandle {
    try_setup_metrics_recorder(MetricsRecorderConfig::default())
        .expect("failed to install Prometheus metrics recorder")
}

/// Install the Prometheus recorder and return a typed error instead of panicking.
pub fn try_setup_metrics_recorder(
    config: MetricsRecorderConfig,
) -> Result<PrometheusHandle, MetricsSetupError> {
    let mut builder = PrometheusBuilder::new();

    for histogram in config.histogram_buckets {
        builder = builder.set_buckets_for_metric(
            Matcher::Full(histogram.metric_name.into()),
            histogram.buckets,
        )?;
    }

    builder.install_recorder()
}