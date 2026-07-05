use std::sync::Arc;
use thiserror::Error;

use crate::metrics::EnrichmentMetrics;

#[derive(Error, Debug)]
pub enum IdempotencyError {
    #[error("Redis error: {0}")]
    RedisError(String),
    #[error("Database error: {0}")]
    DatabaseError(String),
}

pub struct IdempotencyService {
    redis: Arc<redis::Client>,
    metrics: Arc<EnrichmentMetrics>,
    bloom_key: String,
}

impl IdempotencyService {
    pub fn new(redis: Arc<redis::Client>, metrics: Arc<EnrichmentMetrics>, bloom_key: String) -> Self {
        Self { redis, metrics, bloom_key }
    }

    /// Check if event was already processed.
    pub async fn is_duplicate(&self, event_id: &str) -> Result<bool, IdempotencyError> {
        let mut con = self.redis.get_multiplexed_async_connection().await
            .map_err(|e| IdempotencyError::RedisError(e.to_string()))?;

        let in_bloom: bool = redis::cmd("BF.EXISTS")
            .arg(&self.bloom_key)
            .arg(event_id)
            .query_async(&mut con)
            .await
            .map_err(|e| IdempotencyError::RedisError(e.to_string()))?;

        if !in_bloom {
            return Ok(false);
        }

        // TODO: confirm with PostgreSQL query
        Ok(true)
    }

    /// Mark event as processed.
    pub async fn mark_processed(&self, event_id: &str) -> Result<(), IdempotencyError> {
        let mut con = self.redis.get_multiplexed_async_connection().await
            .map_err(|e| IdempotencyError::RedisError(e.to_string()))?;

        // Add to bloom filter
        let _: () = redis::cmd("BF.ADD")
            .arg(&self.bloom_key)
            .arg(event_id)
            .query_async::<_, ()>(&mut con)
            .await
            .map_err(|e| IdempotencyError::RedisError(e.to_string()))?;

        // TODO: insert into PostgreSQL

        Ok(())
    }
}