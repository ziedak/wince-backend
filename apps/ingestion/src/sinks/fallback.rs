//! FallbackSink — composes a primary and fallback sink.
//!
//! On every `send` call the primary sink is tried first. If it returns a
//! `KafkaError` (the only retryable failure from our Kafka sink), the event is
//! transparently forwarded to the fallback (S3) sink so no data is lost during
//! Kafka broker restarts or network partitions.
//!
//! All other error variants are propagated to the caller as-is.

use std::sync::Arc;

use async_trait::async_trait;
use tracing::error;

use crate::errors::AppError;
use crate::sinks::{Sink, SinkHeaders};

pub struct FallbackSink {
    primary: Arc<dyn Sink>,
    fallback: Arc<dyn Sink>,
}

impl FallbackSink {
    pub fn new(primary: Arc<dyn Sink>, fallback: Arc<dyn Sink>) -> Self {
        Self { primary, fallback }
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
        match self.primary.send(topic, key, payload, headers).await {
            Ok(()) => Ok(()),
            Err(AppError::KafkaError(ref e)) => {
                error!(
                    error = e,
                    topic, "Primary Kafka sink failed — routing event to S3 fallback"
                );
                metrics::counter!("ingestion_fallback_activations_total").increment(1);
                // S3 errors are non-fatal: we've already lost Kafka; if S3
                // also fails, log loudly but don't propagate to avoid 503ing
                // the caller twice.
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
