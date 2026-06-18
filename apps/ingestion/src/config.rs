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
}

impl AppConfig {
    /// Historical threshold converted to milliseconds for timestamp comparison.
    pub fn historical_threshold_ms(&self) -> i64 {
        (self.historical_threshold_days as i64) * 24 * 60 * 60 * 1000
    }
}
