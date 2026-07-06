use envconfig::Envconfig;

#[derive(Envconfig, Clone, Debug)]
pub struct AppConfig {
    #[envconfig(from = "KAFKA_BROKERS", default = "kafka:29092")]
    pub kafka_brokers: String,

    #[envconfig(from = "KAFKA_RAW_TOPIC", default = "raw.events")]
    pub kafka_raw_topic: String,

    #[envconfig(from = "KAFKA_ENRICHED_TOPIC", default = "enriched.events")]
    pub kafka_enriched_topic: String,

    #[envconfig(from = "KAFKA_DLQ_TOPIC", default = "dead.letters")]
    pub kafka_dlq_topic: String,

    #[envconfig(from = "KAFKA_CONSUMER_GROUP", default = "enrichment-group")]
    pub kafka_consumer_group: String,

    #[envconfig(from = "REDIS_URL", default = "redis://redis:6379")]
    pub redis_url: String,

    #[envconfig(from = "REDIS_BLOOM_KEY", default = "idem:bloom")]
    #[allow(dead_code)]
    pub bloom_filter_key: String,

    #[envconfig(
        from = "POSTGRES_URL",
        default = "postgresql://admin:password@pgbouncer:6432/app_db"
    )]
    pub postgres_url: String,

    #[envconfig(from = "SESSION_TTL_SECONDS", default = "1800")]
    pub session_ttl_seconds: u64,

    #[envconfig(from = "MAX_POLL_RECORDS", default = "500")]
    pub max_poll_records: u32,

    #[envconfig(from = "COMMIT_INTERVAL_MS", default = "5000")]
    pub commit_interval_ms: u64,

    #[envconfig(from = "DECISION_ENGINE_URL", default = "http://decision-engine:3007")]
    pub decision_engine_url: String,

    #[envconfig(from = "PORT", default = "3002")]
    pub port: u16,


    #[envconfig(from = "INTERNAL_SECRET", default = "dev-internal-secret")]
    pub internal_secret: String,

    #[envconfig(from = "LOG_LEVEL", default = "info")]
    pub log_level: String,

    /// Time-based window TTL in seconds (events older than this are trimmed from sorted sets).
    #[envconfig(from = "SESSION_WINDOW_TTL_SECONDS", default = "300")]
    pub session_window_ttl_seconds: u64,

    /// Idempotency SETNX key TTL in seconds (prevents duplicate processing within this window).
    #[envconfig(from = "IDEMPOTENCY_TTL_SECONDS", default = "300")]
    pub idempotency_ttl_seconds: u64,

    /// Decay factor α for EWMA velocity features (0 < α ≤ 1; lower = slower adaptation).
    #[envconfig(from = "EWMA_ALPHA", default = "0.1")]
    pub ewma_alpha: f64,
}

impl AppConfig {
    /// Parse a comma-separated Kafka broker list into a Vec<String>.
    pub fn kafka_brokers_vec(&self) -> Vec<String> {
        self.kafka_brokers
            .split(',')
            .map(|s| s.trim().to_string())
            .collect()
    }
}
