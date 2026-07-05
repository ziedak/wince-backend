use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;

use crate::metrics::EnrichmentMetrics;
use crate::config::AppConfig;
use crate::enricher::Enricher;
use crate::idempotency::IdempotencyService;
use crate::trigger_forwarder::TriggerForwarder;
use rust_shared_types::{EnrichResult, EnrichedEvent};

const RETRY_DELAYS_MS: &[u64] = &[100, 200, 400];

#[derive(Error, Debug)]
pub enum ConsumerError {
    #[error("Kafka error: {0}")]
    KafkaError(String),
    #[error("Redis error: {0}")]
    RedisError(String),
}

#[derive(Clone)]
pub struct ConsumerState {
    pub subscribed: bool,
    pub backing_off: bool,
}

pub struct EnrichmentConsumer {
    config: AppConfig,
    enricher: Arc<Enricher>,
    idempotency: Arc<IdempotencyService>,
    metrics: Arc<EnrichmentMetrics>,
    trigger_forwarder: Option<Arc<TriggerForwarder>>,
    state: ConsumerState,
    is_shutting_down: bool,
}

impl EnrichmentConsumer {
    pub fn new(
        config: AppConfig,
        enricher: Arc<Enricher>,
        idempotency: Arc<IdempotencyService>,
        metrics: Arc<EnrichmentMetrics>,
        trigger_forwarder: Option<Arc<TriggerForwarder>>,
    ) -> Self {
        Self {
            config,
            enricher,
            idempotency,
            metrics,
            trigger_forwarder,
            state: ConsumerState { subscribed: false, backing_off: false },
            is_shutting_down: false,
        }
    }

    pub async fn start(&self) -> Result<(), ConsumerError> {
        let brokers = self.config.kafka_brokers_vec();
        let consumer = rdkafka::ClientConfig::new()
            .set("bootstrap.servers", &brokers.join(","))
            .set("group.id", &self.config.kafka_consumer_group)
            .set("session.timeout.ms", "30000")
            .set("heartbeat.interval.ms", "3000")
            .set("enable.auto.commit", "false")
            .set("auto.offset.reset", "earliest")
            .set("max.poll.records", self.config.max_poll_records.to_string())
            .create::<rdkafka::consumer::StreamConsumer>()
            .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        let producer = rdkafka::ClientConfig::new()
            .set("bootstrap.servers", &brokers.join(","))
            .set("client.id", "enrichment-session-producer")
            .create::<rdkafka::producer::FutureProducer>()
            .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        consumer.subscribe(&[self.config.kafka_raw_topic.as_str()])
            .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        self.state.subscribed = true;
        tracing::info!(topic = %self.config.kafka_raw_topic, "Subscribed to raw events topic");

        let mut message_stream = consumer.stream();

        while let Some(message_result) = message_stream.next().await {
            if self.is_shutting_down {
                break;
            }

            match message_result {
                Ok(message) => {
                    let key = message.key()
                        .map(|k| String::from_utf8_lossy(k).to_string())
                        .unwrap_or_else(|| "unknown".to_string());

                    let payload = match message.payload() {
                        Some(p) => String::from_utf8_lossy(p).to_string(),
                        None => {
                            tracing::warn!(key = %key, "Empty message");
                            self.metrics.events_processed("dropped");
                            continue;
                        }
                    };

                    // Parse JSON
                    let raw: rust_shared_types::RawEvent = match serde_json::from_str(&payload) {
                        Ok(e) => e,
                        Err(e) => {
                            tracing::warn!(key = %key, error = %e, "Invalid JSON, sending to DLQ");
                            self.metrics.events_processed("dropped");
                            continue;
                        }
                    };

                    let t0 = Instant::now();

                    // Enrich with retry
                    let result = match with_retry(
                        || self.enricher.enrich(raw.clone()),
                        RETRY_DELAYS_MS,
                    ).await {
                        Ok(r) => r,
                        Err(e) => {
                            tracing::error!(error = %e, event_id = %raw.event_id, "Enrichment failed after retries, backing off 5s");
                            self.state.backing_off = true;
                            tokio::time::sleep(Duration::from_millis(5000)).await;
                            self.state.backing_off = false;
                            self.metrics.events_processed("dropped");
                            continue;
                        }
                    };

                    match result {
                        EnrichResult::Duplicate => {
                            self.metrics.events_processed("deduplicated");
                        }
                        EnrichResult::Enriched(enriched) => {
                            // Produce to enriched topic
                            let serialized = match serde_json::to_string(&enriched) {
                                Ok(s) => s,
                                Err(e) => {
                                    tracing::error!(error = %e, "Failed to serialize enriched event");
                                    self.metrics.events_processed("dropped");
                                    continue;
                                }
                            };

                            if let Err(e) = produce_message(&producer, &self.config.kafka_enriched_topic, &raw.session_id, &serialized).await {
                                tracing::error!(error = %e, event_id = %raw.event_id, "Produce failed, sending to DLQ");
                            } else {
                                // Mark idempotent only after confirmed produce
                                if let Err(e) = self.idempotency.mark_processed(&raw.event_id).await {
                                    tracing::warn!(error = %e, event_id = %raw.event_id, "Failed to mark processed");
                                }

                                // Fast-path: forward trigger events
                                if let Some(forwarder) = &self.trigger_forwarder {
                                    let event = Arc::new(enriched.clone());
                                    let forwarder = forwarder.clone();
                                    tokio::spawn(async move {
                                        forwarder.maybe_forward(event).await;
                                    });
                                }

                                self.metrics.processing_latency(t0.elapsed().as_millis() as f64);
                                self.metrics.events_processed("success");
                            }
                        }
                    }

                    // Commit offset
                    consumer.store_offset(&message);
                    consumer.commit_consumer_state(&mut std::io::empty())
                        .ok();
                }
                Err(e) => {
                    tracing::error!(error = %e, "Message stream error");
                }
            }
        }

        Ok(())
    }

    pub async fn shutdown(&self) {
        self.is_shutting_down = true;
        tracing::info!("Shutdown requested");
    }
}

/// Retry a future with exponential backoff.
async fn with_retry<F, Fut, T, E>(mut f: F, delays_ms: &[u64]) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
{
    for (attempt, &delay_ms) in delays_ms.iter().enumerate() {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                if attempt < delays_ms.len() {
                    tracing::warn!(attempt = attempt + 1, error = %e, "Retrying after error");
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                } else {
                    return Err(e);
                }
            }
        }
    }
    unreachable!()
}

/// Produce a single message to Kafka.
async fn produce_message(
    producer: &rdkafka::producer::FutureProducer,
    topic: &str,
    key: &str,
    payload: &str,
) -> Result<(), ConsumerError> {
    let record = rdkafka::producer::FutureRecord::to(topic)
        .key(key)
        .payload(payload);

    producer.send(record, rdkafka::util::Timeout::Never)
        .await
        .map_err(|(e, _)| ConsumerError::KafkaError(e.to_string()))?;

    Ok(())
}