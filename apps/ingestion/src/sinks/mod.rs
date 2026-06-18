//! Sink abstraction layer.
//!
//! All event-producing code in `pipeline.rs` talks to a `&dyn Sink` rather
//! than directly to `rdkafka`. This makes the Kafka sink swappable with the
//! S3 fallback sink or a no-op sink for tests.

use async_trait::async_trait;

use crate::errors::AppError;

pub mod fallback;
pub mod kafka;
pub mod s3;

/// Minimal write interface shared by every sink implementation.
#[async_trait]
pub trait Sink: Send + Sync {
    /// Produce a single JSON-encoded event to the named topic.
    ///
    /// `key` is the Kafka partition key (session ID for normal events, empty
    /// string `""` for overflow events that should round-robin).
    async fn send(&self, topic: &str, key: &str, payload: &str) -> Result<(), AppError>;
}
