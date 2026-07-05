use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;

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

    pub async fn start(&mut self) -> Result<(), ConsumerError> {
        let brokers = self.config.kafka_brokers_vec();
        let consumer: KafkaConsumer = create_consumer_client(KafkaConsumerConfig::new(
            brokers.clone(),
            "enrichment-session",
            self.config.kafka_consumer_group.clone(),
        ))
        .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        let producer: KafkaProducer = create_producer_client(KafkaProducerConfig::new(
            brokers,
            "enrichment-session-producer",
        ))
        .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        consumer.subscribe(&[self.config.kafka_raw_topic.as_str()])
            .map_err(|e| ConsumerError::KafkaError(e.to_string()))?;

        self.state.subscribed = true;
        tracing::info!(topic = %self.config.kafka_raw_topic, "Subscribed to raw events topic");

        loop {
            if self.is_shutting_down {
                break;
            }

            match consumer.recv().await {
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

                    // Enrich directly; this path is intentionally non-fallible.
                    let result = self.enricher.enrich(raw.clone()).await;

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

                            if let Err(e) = producer
                                .send_raw(
                                    &self.config.kafka_enriched_topic,
                                    Some(&raw.session_id),
                                    serialized.as_bytes(),
                                )
                                .await
                            {
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
                    if let Err(e) = consumer.commit_message(&message, CommitMode::Async) {
                        tracing::warn!(error = %e, "Failed to commit message");
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Message stream error");
                }
            }
        }

        consumer.shutdown();
        if let Err(e) = producer.shutdown() {
            tracing::warn!(error = %e, "Kafka producer shutdown failed");
        }

        Ok(())
    }

    pub async fn shutdown(&mut self) {
        self.is_shutting_down = true;
        tracing::info!("Shutdown requested");
    }
}