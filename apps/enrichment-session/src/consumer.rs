use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use thiserror::Error;
use serde::Serialize;

use crate::metrics::EnrichmentMetrics;
use crate::config::AppConfig;
use crate::enricher::Enricher;
use crate::idempotency::IdempotencyService;
use crate::trigger_forwarder::TriggerForwarder;
use rust_shared_types::EnrichResult;
use rust_kafka_client::{
    create_consumer_client,
    create_producer_client,
    CommitMode,
    KafkaConsumer,
    KafkaConsumerConfig,
    KafkaProducer,
    KafkaProducerConfig,
    Message,
};

/// Retry delays for produce: 1 initial attempt + 3 retries at 100 / 200 / 400 ms.
const PRODUCE_RETRY_DELAYS_MS: [u64; 3] = [100, 200, 400];

#[derive(Serialize)]
struct DlqEnvelope<'a> {
    reason: &'a str,
    source_topic: &'a str,
    target_topic: &'a str,
    key: &'a str,
    payload: &'a str,
    error: &'a str,
    event_id: Option<&'a str>,
}

#[derive(Error, Debug)]
pub enum ConsumerError {
    #[error("Kafka error: {0}")]
    KafkaError(String),
}

/// Consumer liveness / readiness state shared with the health server.
#[derive(Clone, Default)]
pub struct SharedConsumerState {
    pub subscribed: Arc<AtomicBool>,
    pub backing_off: Arc<AtomicBool>,
}

pub struct EnrichmentConsumer {
    config: AppConfig,
    enricher: Arc<Enricher>,
    idempotency: Arc<IdempotencyService>,
    metrics: Arc<EnrichmentMetrics>,
    trigger_forwarder: Option<Arc<TriggerForwarder>>,
    state: SharedConsumerState,
    shutdown_flag: Arc<AtomicBool>,
}

impl EnrichmentConsumer {
    pub fn new(
        config: AppConfig,
        enricher: Arc<Enricher>,
        idempotency: Arc<IdempotencyService>,
        metrics: Arc<EnrichmentMetrics>,
        trigger_forwarder: Option<Arc<TriggerForwarder>>,
        state: SharedConsumerState,
        shutdown_flag: Arc<AtomicBool>,
    ) -> Self {
        Self { config, enricher, idempotency, metrics, trigger_forwarder, state, shutdown_flag }
    }

    pub async fn start(&mut self) -> Result<(), ConsumerError> {
        let brokers = self.config.kafka_brokers_vec();
        let mut consumer_config = KafkaConsumerConfig::new(
            brokers.clone(),
            "enrichment-session",
            self.config.kafka_consumer_group.clone(),
        );
        consumer_config.max_poll_records = self.config.max_poll_records.max(1) as i32;
        consumer_config.enable_auto_offset_store = false;

        let consumer: KafkaConsumer = create_consumer_client(consumer_config)
            .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        let producer: KafkaProducer = create_producer_client(KafkaProducerConfig::new(
            brokers,
            "enrichment-session-producer",
        ))
        .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        consumer.subscribe(&[self.config.kafka_raw_topic.as_str()])
            .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        self.state.subscribed.store(true, Ordering::Relaxed);
        tracing::info!(topic = %self.config.kafka_raw_topic, "Subscribed to raw events topic");

        let commit_interval = Duration::from_millis(self.config.commit_interval_ms.max(1));
        let mut last_commit = Instant::now();

        loop {
            if self.shutdown_flag.load(Ordering::Relaxed) {
                break;
            }

            match consumer.recv().await {
                Ok(message) => {
                    let key = message.key()
                        .map(|k| String::from_utf8_lossy(k).to_string())
                        .unwrap_or_else(|| "unknown".to_string());

                    let mut record_progress = |reason: &str| {
                        if let Err(e) = consumer.store_offset_from_message(&message) {
                            tracing::warn!(error = %e, reason, "Failed to store offset");
                            if let Err(e) = consumer.commit_message(&message, CommitMode::Async) {
                                tracing::warn!(error = %e, reason, "Fallback commit failed");
                            }
                        } else if last_commit.elapsed() >= commit_interval {
                            if let Err(e) = consumer.commit_consumer_state(CommitMode::Async) {
                                tracing::warn!(error = %e, reason, "Failed to commit stored offsets");
                            }
                            last_commit = Instant::now();
                        }
                    };

                    let Some(payload_bytes) = message.payload() else {
                        tracing::warn!(key = %key, "Empty message");
                        self.send_to_dlq(&producer, "empty_payload", &key, "", "message payload was empty", None).await;
                        record_progress("empty_payload");
                        self.metrics.events_processed("dropped");
                        continue;
                    };

                    let payload = String::from_utf8_lossy(payload_bytes).to_string();

                    let raw: rust_shared_types::RawEvent = match serde_json::from_str(&payload) {
                        Ok(e) => e,
                        Err(e) => {
                            tracing::warn!(key = %key, error = %e, "Invalid JSON, sending to DLQ");
                            self.send_to_dlq(&producer, "invalid_json", &key, &payload, &e.to_string(), None).await;
                            record_progress("invalid_json");
                            self.metrics.events_processed("dropped");
                            continue;
                        }
                    };

                    let t0 = Instant::now();
                    let result = self.enricher.enrich(raw.clone()).await;

                    match result {
                        EnrichResult::Duplicate => {
                            record_progress("processed");
                            self.metrics.events_processed("deduplicated");
                        }
                        EnrichResult::Enriched(enriched) => {
                            let serialized = match serde_json::to_string(&enriched) {
                                Ok(s) => s,
                                Err(e) => {
                                    tracing::error!(error = %e, "Failed to serialize enriched event");
                                    self.send_to_dlq(&producer, "serialization_failed", &key, &payload, &e.to_string(), Some(&raw.event_id)).await;
                                    record_progress("serialization_failed");
                                    self.metrics.events_processed("dropped");
                                    continue;
                                }
                            };

                            match retry_produce(&producer, &self.config.kafka_enriched_topic, &raw.session_id, serialized.as_bytes()).await {
                                Ok(()) => {
                                    // Mark idempotent only after confirmed produce — preserves at-least-once
                                    if let Err(e) = self.idempotency.mark_processed(&raw.event_id, raw.store_id).await {
                                        tracing::warn!(error = %e, event_id = %raw.event_id, "Failed to mark processed");
                                    }
                                    // Fast-path: forward trigger events (fire-and-forget)
                                    if let Some(forwarder) = &self.trigger_forwarder {
                                        let event = Arc::new(enriched.clone());
                                        let forwarder = forwarder.clone();
                                        tokio::spawn(async move { forwarder.maybe_forward(event).await; });
                                    }
                                    self.metrics.processing_latency(t0.elapsed().as_millis() as f64);
                                    self.metrics.events_processed("success");
                                    record_progress("processed");
                                }
                                Err(e) => {
                                    tracing::error!(error = %e, event_id = %raw.event_id, "Produce failed after retries, sending to DLQ");
                                    self.send_to_dlq(&producer, "produce_failed", &key, &payload, &e.to_string(), Some(&raw.event_id)).await;
                                    record_progress("produce_failed");
                                    self.metrics.events_processed("dropped");
                                    // Back off to signal degraded state to readiness probe
                                    self.state.backing_off.store(true, Ordering::Relaxed);
                                    tokio::time::sleep(Duration::from_secs(5)).await;
                                    self.state.backing_off.store(false, Ordering::Relaxed);
                                    continue;
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Message stream error");
                }
            }
        }

        self.state.subscribed.store(false, Ordering::Relaxed);
        if let Err(e) = consumer.commit_consumer_state(CommitMode::Sync) {
            tracing::warn!(error = %e, "Failed to commit final consumer state");
        }
        consumer.shutdown();
        if let Err(e) = producer.shutdown() {
            tracing::warn!(error = %e, "Kafka producer shutdown failed");
        }

        Ok(())
    }

    async fn send_to_dlq(
        &self,
        producer: &KafkaProducer,
        reason: &'static str,
        key: &str,
        payload: &str,
        error: &str,
        event_id: Option<&str>,
    ) {
        let envelope = DlqEnvelope {
            reason,
            source_topic: self.config.kafka_raw_topic.as_str(),
            target_topic: self.config.kafka_dlq_topic.as_str(),
            key,
            payload,
            error,
            event_id,
        };
        if let Err(dlq_error) = producer.send_json(&self.config.kafka_dlq_topic, Some(key), &envelope).await {
            tracing::error!(reason, error = %dlq_error, "Failed to publish message to DLQ");
        }
    }
}

/// Retry produce with exponential back-off: 1 attempt + up to 3 retries at 100/200/400 ms.
async fn retry_produce(
    producer: &KafkaProducer,
    topic: &str,
    key: &str,
    payload: &[u8],
) -> Result<(), rust_kafka_client::KafkaClientError> {
    let mut last_err = None;
    for delay_ms in std::iter::once(0u64).chain(PRODUCE_RETRY_DELAYS_MS.iter().copied()) {
        if delay_ms > 0 {
            tracing::warn!(delay_ms, "Produce failed, retrying");
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }
        match producer.send_raw(topic, Some(key), payload).await {
            Ok(()) => return Ok(()),
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap())
}