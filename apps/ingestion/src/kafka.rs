use rdkafka::config::ClientConfig;
use rdkafka::error::KafkaError;
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::util::Timeout;
use tracing::{error, info};

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::health::HealthHandle;

/// rdkafka ClientContext that drives the HealthHandle from the stats callback.
/// The stats callback fires on every librdkafka internal statistics interval,
/// giving us broker-UP detection without polling.
pub struct KafkaContext {
    health: HealthHandle,
}

impl rdkafka::ClientContext for KafkaContext {
    fn stats(&self, stats: rdkafka::Statistics) {
        let any_broker_up = stats.brokers.values().any(|b| b.state == "UP");
        if any_broker_up {
            self.health.report_kafka_healthy();
        }
    }
}

pub type AppProducer = FutureProducer<KafkaContext>;

/// Creates an idempotent Kafka FutureProducer.
/// Idempotence and acks=all are always enabled — not configurable.
pub fn create_producer(config: &AppConfig, health: HealthHandle) -> Result<AppProducer, KafkaError> {
    let producer = ClientConfig::new()
        .set("bootstrap.servers", &config.kafka_hosts)
        .set("linger.ms", config.kafka_producer_linger_ms.to_string())
        .set(
            "queue.buffering.max.kbytes",
            (config.kafka_producer_queue_mib * 1024).to_string(),
        )
        .set(
            "message.timeout.ms",
            config.kafka_message_timeout_ms.to_string(),
        )
        .set("compression.codec", &config.kafka_compression_codec)
        // Always idempotent — we control the cluster.
        .set("enable.idempotence", "true")
        .set("acks", "all")
        // Required for idempotence.
        .set("max.in.flight.requests.per.connection", "5")
        // Enable statistics callbacks so HealthHandle gets broker-UP signals.
        .set("statistics.interval.ms", "5000")
        .create_with_context(KafkaContext { health })?;

    info!("Kafka producer created for brokers: {}", &config.kafka_hosts);
    Ok(producer)
}

/// Produces a single JSON-serialized event to a Kafka topic.
/// Key is the session_id for partition affinity.
///
/// The Timeout::Never here is intentional: the producer queue is bounded
/// by `queue.buffering.max.kbytes` and `message.timeout.ms` already
/// caps the overall delivery window. Using a hard 5-second async wait
/// would block the tokio task and reduce throughput under backpressure;
/// instead we let rdkafka manage the queue and surface errors via
/// message.timeout.ms expiry.
pub async fn produce(
    producer: &AppProducer,
    topic: &str,
    key: &str,
    payload: &str,
) -> Result<(), AppError> {
    let record = FutureRecord::to(topic)
        .key(key)
        .payload(payload);

    producer
        .send(record, Timeout::Never)
        .await
        .map_err(|(err, _msg)| {
            error!(topic, key, "Kafka produce failed: {err}");
            AppError::KafkaError(err.to_string())
        })?;

    Ok(())
}
