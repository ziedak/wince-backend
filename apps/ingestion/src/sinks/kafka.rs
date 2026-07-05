//! Kafka sink — wraps the shared Rust Kafka client as a `Sink`.

use async_trait::async_trait;

use crate::errors::AppError;
use crate::kafka::{produce, AppProducer};
use crate::sinks::{Sink, SinkHeaders};

pub struct KafkaSink {
    producer: AppProducer,
}

impl KafkaSink {
    pub fn new(producer: AppProducer) -> Self {
        Self { producer }
    }
}

#[async_trait]
impl Sink for KafkaSink {
    async fn send(
        &self,
        topic: &str,
        key: &str,
        payload: &str,
        headers: &SinkHeaders,
    ) -> Result<(), AppError> {
        produce(&self.producer, topic, key, payload, headers).await
    }
}
