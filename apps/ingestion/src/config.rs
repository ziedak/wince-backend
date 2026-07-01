use envconfig::Envconfig;

#[derive(Envconfig, Clone, Debug)]
pub struct AppConfig {
    // ─── Kafka core ──────────────────────────────────────────────────────────
    #[envconfig(from = "KAFKA_HOSTS", default = "localhost:9092")]
    pub kafka_hosts: String,

    /// Default topic for unclassified analytics events
    #[envconfig(from = "KAFKA_TOPIC_RAW", default = "raw.events")]
    pub kafka_topic_raw: String,

    // Phase 4 — per-type topic routing
    #[envconfig(from = "KAFKA_TOPIC_ERROR", default = "error.events")]
    pub kafka_topic_error: String,

    #[envconfig(from = "KAFKA_TOPIC_IDENTIFY", default = "identify.events")]
    pub kafka_topic_identify: String,

    #[envconfig(from = "KAFKA_TOPIC_CHECKOUT", default = "checkout.events")]
    pub kafka_topic_checkout: String,

    /// Dead-letter queue for invalid / oversized events
    #[envconfig(from = "KAFKA_TOPIC_DLQ", default = "dlq.events")]
    pub kafka_topic_dlq: String,

    // Phase 5 — overflow routing for hot partitions
    #[envconfig(from = "KAFKA_TOPIC_OVERFLOW", default = "overflow.events")]
    pub kafka_topic_overflow: String,

    // Phase 9 — historical rerouting
    #[envconfig(from = "KAFKA_TOPIC_HISTORICAL", default = "historical.events")]
    pub kafka_topic_historical: String,

    #[envconfig(from = "KAFKA_PRODUCER_LINGER_MS", default = "20")]
    pub kafka_producer_linger_ms: u32,

    #[envconfig(from = "KAFKA_PRODUCER_QUEUE_MIB", default = "400")]
    pub kafka_producer_queue_mib: u32,

    #[envconfig(from = "KAFKA_MESSAGE_TIMEOUT_MS", default = "20000")]
    pub kafka_message_timeout_ms: u32,

    #[envconfig(from = "KAFKA_COMPRESSION_CODEC", default = "snappy")]
    pub kafka_compression_codec: String,

    // ─── Redis ───────────────────────────────────────────────────────────────
    #[envconfig(from = "REDIS_URL", default = "redis://localhost:6379")]
    pub redis_url: String,

    #[envconfig(from = "REDIS_BLOOM_KEY", default = "idem:bloom")]
    pub redis_bloom_key: String,

    // ─── HTTP server ─────────────────────────────────────────────────────────
    #[envconfig(from = "PORT", default = "3001")]
    pub port: u16,

    #[envconfig(from = "LOG_LEVEL", default = "info")]
    pub log_level: String,

    /// Phase 8 — total request timeout; limits slow-lorris-style connections
    #[envconfig(from = "HTTP_REQUEST_TIMEOUT_MS", default = "30000")]
    pub http_request_timeout_ms: u64,

    // ─── Phase 2 — Validation hardening ──────────────────────────────────────
    /// Maximum serialized event payload size in bytes (default 1 MiB).
    /// Events exceeding this are sent to the DLQ and dropped.
    #[envconfig(from = "MAX_EVENT_BYTES", default = "1048576")]
    pub max_event_bytes: usize,

    // ─── Phase 3 — Per-store rate limiting ───────────────────────────────────
    #[envconfig(from = "RATE_LIMIT_ENABLED", default = "true")]
    pub rate_limit_enabled: bool,

    #[envconfig(from = "RATE_LIMIT_PER_SECOND", default = "1000")]
    pub rate_limit_per_second: u32,

    /// Token bucket burst size (events above steady-state that can be absorbed)
    #[envconfig(from = "RATE_LIMIT_BURST", default = "5000")]
    pub rate_limit_burst: u32,

    // ─── Phase 5 — Hot-partition overflow routing ─────────────────────────────
    /// When enabled, high-volume (store_id, anon) pairs are rerouted to the
    /// overflow topic with no partition key, preventing hot-partition lag.
    #[envconfig(from = "OVERFLOW_ENABLED", default = "false")]
    pub overflow_enabled: bool,

    #[envconfig(from = "OVERFLOW_PER_SECOND", default = "100")]
    pub overflow_per_second: u32,

    #[envconfig(from = "OVERFLOW_BURST", default = "1000")]
    pub overflow_burst: u32,

    // ─── Phase 4 — Distributed rate limiting ──────────────────────────────────
    /// When true, a Redis sliding-window limiter enforces the per-store rate
    /// across all service replicas.  Runs after the in-process gate.
    #[envconfig(from = "DISTRIBUTED_RATE_LIMIT_ENABLED", default = "false")]
    pub distributed_rate_limit_enabled: bool,

    /// Maximum requests per store per second, shared across all replicas.
    #[envconfig(from = "DISTRIBUTED_RATE_LIMIT_PER_SECOND", default = "1000")]
    pub distributed_rate_limit_per_second: u64,

    /// Dry-run mode for the in-process store rate limiter.
    #[envconfig(from = "RATE_LIMIT_DRY_RUN", default = "false")]
    pub rate_limit_dry_run: bool,

    /// Dry-run mode for the hot-partition overflow limiter.
    #[envconfig(from = "OVERFLOW_DRY_RUN", default = "false")]
    pub overflow_dry_run: bool,

    /// Dry-run mode for the distributed Redis rate limiter.
    #[envconfig(from = "DISTRIBUTED_RATE_LIMIT_DRY_RUN", default = "false")]
    pub distributed_rate_limit_dry_run: bool,

    // ─── Phase 6 — S3 fallback sink ───────────────────────────────────────────
    /// When true, Kafka errors route events to S3 instead of dropping them.
    #[envconfig(from = "S3_FALLBACK_ENABLED", default = "false")]
    pub s3_fallback_enabled: bool,

    /// Required when S3_FALLBACK_ENABLED=true
    #[envconfig(from = "S3_FALLBACK_BUCKET")]
    pub s3_fallback_bucket: Option<String>,

    /// Optional: override S3 endpoint for MinIO or other S3-compatible stores
    #[envconfig(from = "S3_ENDPOINT_URL")]
    pub s3_endpoint_url: Option<String>,

    #[envconfig(from = "S3_REGION", default = "us-east-1")]
    pub s3_region: String,

    // ─── Phase 9 — Historical event rerouting ────────────────────────────────
    /// When true, events older than HISTORICAL_THRESHOLD_DAYS are rerouted to
    /// the historical topic to avoid real-time pipeline lag spikes.
    #[envconfig(from = "HISTORICAL_REROUTING_ENABLED", default = "false")]
    pub historical_rerouting_enabled: bool,

    #[envconfig(from = "HISTORICAL_THRESHOLD_DAYS", default = "1")]
    pub historical_threshold_days: u32,

    // ─── Phase 3 — Body read safety ──────────────────────────────────────────
    /// Per-chunk body read timeout in milliseconds.
    /// When set, aborts requests where the client stalls mid-upload for longer
    /// than this window (slow-loris protection).  Default: disabled.
    #[envconfig(from = "BODY_CHUNK_TIMEOUT_MS")]
    pub body_chunk_timeout_ms: Option<u64>,

    /// Maximum raw (compressed) request body size in bytes (default 10 MiB).
    /// Bodies larger than this are rejected before decompression.
    #[envconfig(from = "MAX_REQUEST_BODY_BYTES", default = "10485760")]
    pub max_request_body_bytes: usize,

    // ─── Phase 5 — Quota limiter ─────────────────────────────────────────────
    /// When true, events for stores in the `quota:exceeded` Redis set are dropped.
    #[envconfig(from = "QUOTA_LIMITER_ENABLED", default = "false")]
    pub quota_limiter_enabled: bool,

    /// How often (seconds) the background task refreshes the exceeded-quota set.
    #[envconfig(from = "QUOTA_REFRESH_INTERVAL_S", default = "60")]
    pub quota_refresh_interval_s: u64,

    // ─── Phase 6 — Event restrictions ─────────────────────────────────────────
    /// When true, events for (store_id, event_type) pairs in the Redis
    /// restriction sets are dropped without going to Kafka.
    #[envconfig(from = "RESTRICTIONS_ENABLED", default = "false")]
    pub restrictions_enabled: bool,

    /// How often (seconds) the background task refreshes the restriction cache.
    #[envconfig(from = "RESTRICTIONS_REFRESH_INTERVAL_S", default = "60")]
    pub restrictions_refresh_interval_s: u64,

    // ─── Phase 8 — Observability (OTLP + graceful drain) ─────────────────────
    /// OTLP gRPC endpoint (e.g. `http://tempo:4317`).  When unset, spans are
    /// only emitted via the JSON log layer.
    #[envconfig(from = "OTEL_EXPORTER_OTLP_ENDPOINT")]
    pub otel_exporter_otlp_endpoint: Option<String>,

    /// Service name reported in OTel resource attributes (default: "ingestion").
    #[envconfig(from = "OTEL_SERVICE_NAME", default = "ingestion")]
    pub otel_service_name: String,

    /// Trace sampling ratio 0.0–1.0.  1.0 samples every request (default).
    #[envconfig(from = "OTEL_SAMPLE_RATIO", default = "1.0")]
    pub otel_sample_ratio: f64,

    /// Seconds to wait for the Kafka producer to flush on graceful shutdown.
    #[envconfig(from = "KAFKA_DRAIN_TIMEOUT_SECS", default = "30")]
    pub kafka_drain_timeout_secs: u64,

    // ─── Bloom filter tuning ──────────────────────────────────────────────────
    /// Expected maximum distinct events per day per bloom window key.
    /// A too-small value increases false-positive duplicate drops.
    /// Default: 1 million events per day.
    #[envconfig(from = "BLOOM_CAPACITY", default = "1000000")]
    pub bloom_filter_capacity: u64,

    /// Desired false-positive probability for the bloom filter (0 < fpp < 1).
    /// Default: 0.1 % (one false duplicate drop per 1 000 unique events).
    #[envconfig(from = "BLOOM_FPP", default = "0.001")]
    pub bloom_filter_fpp: f64,

    /// When true (default), all bloom checks for a batch are pipelined into a
    /// single Redis round-trip instead of one round-trip per event.
    /// Set to false for emergency rollback to per-event behaviour.
    #[envconfig(from = "BATCH_BLOOM_ENABLED", default = "true")]
    pub batch_bloom_enabled: bool,

    // ─── S3 WAL ───────────────────────────────────────────────────────────────
    /// When true (default when S3 fallback is enabled), events are written to a
    /// local SQLite WAL before the in-memory S3 buffer. On restart, un-flushed
    /// entries are replayed to S3, preventing data loss on process crash.
    #[envconfig(from = "WAL_ENABLED", default = "true")]
    pub wal_enabled: bool,

    /// Path for the SQLite WAL database file.
    #[envconfig(from = "WAL_DB_PATH", default = "/tmp/ingestion-s3-wal.db")]
    pub wal_db_path: String,

    // ─── Advisory Kafka health ────────────────────────────────────────────────
    /// When true (default when S3 fallback is enabled), FallbackSink checks
    /// Kafka health staleness before each send. If Kafka has not reported
    /// healthy within kafka_health_threshold_ms, events route directly to S3.
    #[envconfig(from = "ADVISORY_FALLBACK_ENABLED", default = "true")]
    pub advisory_fallback_enabled: bool,

    /// Milliseconds without a Kafka healthy report before the advisory fallback
    /// activates. Default 15 s = 3× the rdkafka statistics.interval.ms (5 s).
    #[envconfig(from = "KAFKA_HEALTH_THRESHOLD_MS", default = "15000")]
    pub kafka_health_threshold_ms: i64,
}

impl AppConfig {
    /// Historical threshold converted to milliseconds for timestamp comparison.
    pub fn historical_threshold_ms(&self) -> i64 {
        (self.historical_threshold_days as i64) * 24 * 60 * 60 * 1000
    }
}
