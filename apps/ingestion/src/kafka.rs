use std::time::Duration;

use rdkafka::message::{Header, OwnedHeaders};
use rdkafka::producer::FutureRecord;
use rdkafka::util::Timeout;
use tracing::{error, info, warn};

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::health::HealthHandle;
use crate::sinks::SinkHeaders;
use rust_kafka_client::{KafkaProducer, KafkaProducerConfig};

pub type AppProducer = KafkaProducer;

/// Creates an idempotent Kafka producer wrapper.
/// Idempotence and acks=all are always enabled — not configurable.
pub fn create_producer(config: &AppConfig, health: HealthHandle) -> Result<AppProducer, rust_kafka_client::KafkaClientError> {
    let producer_config = KafkaProducerConfig {
        transport: rust_kafka_client::KafkaTransportConfig {
            brokers: config
                .kafka_hosts
                .split(',')
                .map(|broker| broker.trim().to_string())
                .filter(|broker| !broker.is_empty())
                .collect(),
            client_id: "ingestion-producer".to_string(),
            connection_timeout: Duration::from_secs(3),
            request_timeout: Duration::from_secs(30),
        },
        delivery_timeout: Duration::from_millis(u64::from(config.kafka_message_timeout_ms)),
        linger: Duration::from_millis(u64::from(config.kafka_producer_linger_ms)),
        compression_type: config.kafka_compression_codec.clone(),
        enable_idempotence: true,
        acks: "all".to_string(),
        retries: i32::MAX,
        max_in_flight_requests_per_connection: 5,
        batch_num_messages: 10_000,
        queue_buffering_max_messages: 100_000,
        queue_buffering_max_kbytes: config.kafka_producer_queue_mib as i32 * 1024,
    };

    let producer = KafkaProducer::new(producer_config)?;
    health.report_kafka_healthy();

    let health_probe = producer.clone();
    let health_handle = health.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(5));
        loop {
            ticker.tick().await;
            if health_probe.health_check().is_ok() {
                health_handle.report_kafka_healthy();
            }
        }
    });

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
        .inner()
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
        let _ = timeout;
        producer.flush()
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
    if let Some(ref priority) = h.priority {
        hdrs = hdrs.insert(Header { key: "priority", value: Some(priority.as_str()) });
    }

    hdrs
}
