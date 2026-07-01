//! FallbackSink — composes a primary and fallback sink.
//!
//! On every `send` call the primary sink is tried first. If it returns a
//! `KafkaError` (the only retryable failure from our Kafka sink), the event is
//! transparently forwarded to the fallback (S3) sink so no data is lost during
//! Kafka broker restarts or network partitions.
//!
//! When constructed with `new_with_health`, FallbackSink also performs an
//! *advisory* health check before each send: if Kafka has not reported healthy
//! within `threshold_ms` milliseconds (i.e. the rdkafka stats callback has
//! gone silent), events are proactively routed to S3 without attempting Kafka
//! at all. This prevents latency spikes caused by waiting for producer timeouts
//! when a broker is known-dead.
//!
//! All other error variants are propagated to the caller as-is.

use std::sync::Arc;

use async_trait::async_trait;
use tracing::error;

use crate::errors::AppError;
use crate::health::HealthHandle;
use crate::sinks::{Sink, SinkHeaders};

pub struct FallbackSink {
    primary: Arc<dyn Sink>,
    fallback: Arc<dyn Sink>,
    /// Optional advisory health guard. `None` → pure reactive fallback.
    health: Option<HealthHandle>,
    /// Only used when `health` is `Some`.
    advisory_enabled: bool,
    threshold_ms: i64,
}

impl FallbackSink {
    /// Reactive-only fallback: routes to S3 only after a Kafka error.
    #[allow(dead_code)]
    pub fn new(primary: Arc<dyn Sink>, fallback: Arc<dyn Sink>) -> Self {
        Self {
            primary,
            fallback,
            health: None,
            advisory_enabled: false,
            threshold_ms: 0,
        }
    }

    /// Fallback with advisory health routing.
    ///
    /// When `advisory_enabled` is `true` and Kafka has not reported healthy
    /// within `threshold_ms`, events bypass Kafka entirely and go straight to
    /// the fallback sink, avoiding producer timeout latency.
    pub fn new_with_health(
        primary: Arc<dyn Sink>,
        fallback: Arc<dyn Sink>,
        health: HealthHandle,
        advisory_enabled: bool,
        threshold_ms: i64,
    ) -> Self {
        Self {
            primary,
            fallback,
            health: Some(health),
            advisory_enabled,
            threshold_ms,
        }
    }

    fn kafka_appears_healthy(&self) -> bool {
        if !self.advisory_enabled {
            return true;
        }
        match &self.health {
            Some(h) => h.is_kafka_healthy(self.threshold_ms),
            None => true,
        }
    }
}

#[async_trait]
impl Sink for FallbackSink {
    async fn send(
        &self,
        topic: &str,
        key: &str,
        payload: &str,
        headers: &SinkHeaders,
    ) -> Result<(), AppError> {
        // Advisory proactive rerouting: if Kafka stats have gone silent, skip
        // the producer entirely to avoid waiting for its produce timeout.
        if !self.kafka_appears_healthy() {
            metrics::counter!("ingestion_fallback_proactive_total").increment(1);
            if let Err(s3_err) = self.fallback.send(topic, key, payload, headers).await {
                error!(
                    error = %s3_err,
                    "Proactive S3 fallback failed — event lost"
                );
                metrics::counter!("ingestion_fallback_double_fault_total").increment(1);
            }
            return Ok(());
        }

        // Reactive fallback: try Kafka; on KafkaError route to S3.
        match self.primary.send(topic, key, payload, headers).await {
            Ok(()) => Ok(()),
            Err(AppError::KafkaError(ref e)) => {
                error!(
                    error = e,
                    topic, "Primary Kafka sink failed — routing event to S3 fallback"
                );
                metrics::counter!("ingestion_fallback_activations_total").increment(1);
                if let Err(s3_err) = self.fallback.send(topic, key, payload, headers).await {
                    error!(
                        error = %s3_err,
                        "S3 fallback also failed — event lost"
                    );
                    metrics::counter!("ingestion_fallback_double_fault_total").increment(1);
                }
                Ok(())
            }
            Err(e) => Err(e),
        }
    }
}

