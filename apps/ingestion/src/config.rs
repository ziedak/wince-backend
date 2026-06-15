use envconfig::Envconfig;

#[derive(Envconfig, Clone, Debug)]
pub struct AppConfig {
    /// Kafka broker list (comma-separated)
    #[envconfig(from = "KAFKA_HOSTS", default = "localhost:9092")]
    pub kafka_hosts: String,

    /// Kafka topic for raw events
    #[envconfig(from = "KAFKA_TOPIC_RAW", default = "raw.events")]
    pub kafka_topic_raw: String,

    /// Kafka producer linger in ms — batching window (default 20)
    #[envconfig(from = "KAFKA_PRODUCER_LINGER_MS", default = "20")]
    pub kafka_producer_linger_ms: u32,

    /// Kafka producer in-memory queue size in MiB (default 400)
    #[envconfig(from = "KAFKA_PRODUCER_QUEUE_MIB", default = "400")]
    pub kafka_producer_queue_mib: u32,

    /// Kafka message delivery timeout in ms (default 20000)
    #[envconfig(from = "KAFKA_MESSAGE_TIMEOUT_MS", default = "20000")]
    pub kafka_message_timeout_ms: u32,

    /// Kafka message compression codec: none, gzip, snappy, lz4, zstd
    #[envconfig(from = "KAFKA_COMPRESSION_CODEC", default = "snappy")]
    pub kafka_compression_codec: String,

    /// Redis connection URL
    #[envconfig(from = "REDIS_URL", default = "redis://localhost:6379")]
    pub redis_url: String,

    /// Redis key for the eid Bloom filter
    #[envconfig(from = "REDIS_BLOOM_KEY", default = "idem:bloom")]
    pub redis_bloom_key: String,

    /// HTTP port the service binds to
    #[envconfig(from = "PORT", default = "3001")]
    pub port: u16,

    /// Log level (trace, debug, info, warn, error)
    #[envconfig(from = "LOG_LEVEL", default = "info")]
    pub log_level: String,
}
