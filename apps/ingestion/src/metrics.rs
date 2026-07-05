use rust_shared_metrics::{
    HistogramBuckets, MetricsRecorderConfig, DEFAULT_BATCH_BUCKETS,
    DEFAULT_LATENCY_BUCKETS, DEFAULT_QUERY_LATENCY_BUCKETS, DEFAULT_SIZE_BUCKETS,
    DEFAULT_SKEW_BUCKETS,
};

pub use rust_shared_metrics::try_setup_metrics_recorder;

pub fn ingestion_metrics_recorder_config() -> MetricsRecorderConfig {
    MetricsRecorderConfig::new(&[
        HistogramBuckets {
            metric_name: "ingestion_produce_duration_seconds",
            buckets: DEFAULT_LATENCY_BUCKETS,
        },
        HistogramBuckets {
            metric_name: "ingestion_event_payload_bytes",
            buckets: DEFAULT_SIZE_BUCKETS,
        },
        HistogramBuckets {
            metric_name: "ingestion_batch_size",
            buckets: DEFAULT_BATCH_BUCKETS,
        },
        HistogramBuckets {
            metric_name: "ingestion_clock_skew_seconds",
            buckets: DEFAULT_SKEW_BUCKETS,
        },
        HistogramBuckets {
            metric_name: "ingestion_bloom_dedup_batch_size",
            buckets: DEFAULT_BATCH_BUCKETS,
        },
        HistogramBuckets {
            metric_name: "postgres_query_latency_seconds",
            buckets: DEFAULT_QUERY_LATENCY_BUCKETS,
        },
    ])
}

#[inline]
pub fn report_dropped_event(cause: &'static str) {
    metrics::counter!("ingestion_events_dropped_total", "cause" => cause).increment(1);
}
