use std::time::Duration;

use rdkafka::config::ClientConfig;
use rdkafka::error::KafkaError;
use rdkafka::message::{Header, OwnedHeaders};
use rdkafka::producer::{FutureProducer, FutureRecord, Producer};
use rdkafka::util::Timeout;
use tracing::{error, info, warn};

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::health::HealthHandle;
use crate::sinks::SinkHeaders;

/// rdkafka ClientContext that drives the HealthHandle from the stats callback.
/// The stats callback fires on every librdkafka internal statistics interval,
/// giving us broker-UP detection without polling.
pub struct KafkaContext {
    health: HealthHandle,
}

impl rdkafka::ClientContext for KafkaContext {
    fn stats(&self, stats: rdkafka::Statistics) {
        let brokers_up = stats.brokers.values().any(|b| b.state == "UP");
        if brokers_up {
            self.health.report_kafka_healthy();
        }

        // ─── Prometheus gauges ────────────────────────────────────────────
        let total = stats.brokers.len() as f64;
        let up = stats.brokers.values().filter(|b| b.state == "UP").count() as f64;
        metrics::gauge!("ingestion_kafka_brokers_down").set(total - up);
        metrics::gauge!("ingestion_kafka_producer_queue_depth").set(stats.msg_cnt as f64);
        metrics::gauge!("ingestion_kafka_producer_queue_bytes").set(stats.msg_size as f64);
        metrics::gauge!("ingestion_kafka_producer_queue_depth_limit").set(stats.msg_max as f64);
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

/// Produces a single JSON-serialized event to a Kafka topic with typed headers.
///
/// `key` is the partition key (session_id for normal events, `""` for overflow).
///
/// `Timeout::Never` is intentional: the producer queue is bounded by
/// `queue.buffering.max.kbytes` and `message.timeout.ms` already caps the
/// overall delivery window. A hard async timeout here would block the tokio
/// task under backpressure; instead we let rdkafka manage the queue and
/// surface errors via `message.timeout.ms` expiry.
pub async fn produce(
    producer: &AppProducer,
    topic: &str,
    key: &str,
    payload: &str,
    headers: &SinkHeaders,
) -> Result<(), AppError> {
    let record = FutureRecord::to(topic)
        .key(key)
        .payload(payload)
        .headers(build_kafka_headers(headers));

    producer
        .send(record, Timeout::Never)
        .await
        .map_err(|(err, _msg)| {
            error!(topic, key, "Kafka produce failed: {err}");
            AppError::KafkaError(err.to_string())
        })?;

    Ok(())
}

/// Convert `SinkHeaders` into rdkafka `OwnedHeaders`.
///
/// All numeric fields are formatted as decimal strings. Boolean flags are
/// omitted entirely when `false` to keep the header set compact.
/// Downstream consumers treat a missing header as `false`.
/// Flush all buffered Kafka messages before process exit.
///
/// rdkafka's `flush()` is synchronous and blocks the calling thread, so this
/// runs it inside `spawn_blocking` to avoid stalling a tokio worker.
pub async fn drain_producer(producer: AppProducer, timeout: Duration) {
    let timeout_secs = timeout.as_secs();
    let result = tokio::task::spawn_blocking(move || {
        producer.flush(Timeout::After(timeout))
    })
    .await;
    match result {
        Ok(Ok(())) => info!(timeout_secs, "Kafka producer drained successfully"),
        Ok(Err(e)) => warn!(error = %e, timeout_secs, "Kafka producer drain error"),
        Err(e) => warn!(error = %e, "Kafka producer drain task panicked"),
    }
}

fn build_kafka_headers(h: &SinkHeaders) -> OwnedHeaders {
    let store_id_s = h.store_id.to_string();
    let adjusted_ts_s = h.adjusted_ts.to_string();
    let received_at_s = h.server_received_at.to_string();

    let mut hdrs = OwnedHeaders::new()
        .insert(Header { key: "store_id", value: Some(store_id_s.as_str()) })
        .insert(Header { key: "source", value: Some(h.source.as_str()) })
        .insert(Header { key: "anon_id", value: Some(h.anon_id.as_str()) })
        .insert(Header { key: "session_id", value: Some(h.session_id.as_str()) })
        .insert(Header { key: "event_type", value: Some(h.event_type.as_str()) })
        .insert(Header { key: "adjusted_ts", value: Some(adjusted_ts_s.as_str()) })
        .insert(Header { key: "server_received_at", value: Some(received_at_s.as_str()) });

    if h.force_disable_person_processing {
        hdrs = hdrs.insert(Header {
            key: "force_disable_person_processing",
            value: Some("true"),
        });
    }
    if h.historical_migration {
        hdrs = hdrs.insert(Header { key: "historical_migration", value: Some("true") });
    }
    if h.cookieless_mode {
        hdrs = hdrs.insert(Header { key: "cookieless_mode", value: Some("true") });
    }
    if h.process_person_profile {
        hdrs = hdrs.insert(Header { key: "process_person_profile", value: Some("true") });
    }
    if let Some(ref reason) = h.dlq_reason {
        hdrs = hdrs.insert(Header { key: "dlq_reason", value: Some(reason.as_str()) });
    }

    hdrs
}
