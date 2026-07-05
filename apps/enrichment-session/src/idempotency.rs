use std::sync::Arc;
use thiserror::Error;

use crate::metrics::EnrichmentMetrics;
use rust_postgre_client::PostgresClient;

#[derive(Error, Debug)]
pub enum IdempotencyError {
    #[error("Redis error: {0}")]
    RedisError(String),
    #[error("Database error: {0}")]
    DatabaseError(String),
}

pub struct IdempotencyService {
    redis: Arc<redis::Client>,
    db: Arc<PostgresClient>,
    metrics: Arc<EnrichmentMetrics>,
    bloom_key: String,
}

impl IdempotencyService {
    pub fn new(
        redis: Arc<redis::Client>,
        db: Arc<PostgresClient>,
        metrics: Arc<EnrichmentMetrics>,
        bloom_key: String,
    ) -> Self {
        Self { redis, db, metrics, bloom_key }
    }

    /// Check if event was already processed.
    pub async fn is_duplicate(&self, event_id: &str, store_id: i32) -> Result<bool, IdempotencyError> {
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

        let row: Option<String> = sqlx::query_scalar(
            r#"SELECT event_id::text
               FROM processed_events
               WHERE event_id = $1::uuid AND (store_id = $2 OR store_id IS NULL)
               LIMIT 1"#,
        )
        .bind(event_id)
        .bind(store_id)
        .fetch_optional(self.db.pool())
        .await
        .map_err(|e| IdempotencyError::DatabaseError(e.to_string()))?;

        if row.is_some() {
            return Ok(true);
        }

        self.metrics.bloom_false_positive();
        Ok(false)
    }

    /// Mark event as processed. Runs BF.ADD (Redis) and DB INSERT concurrently.
    pub async fn mark_processed(&self, event_id: &str, store_id: i32) -> Result<(), IdempotencyError> {
        let bloom_fut = async {
            let mut con = self.redis.get_multiplexed_async_connection().await
                .map_err(|e| IdempotencyError::RedisError(e.to_string()))?;
            redis::cmd("BF.ADD")
                .arg(&self.bloom_key)
                .arg(event_id)
                .query_async::<_, ()>(&mut con)
                .await
                .map_err(|e| IdempotencyError::RedisError(e.to_string()))
        };

        let db_fut = async {
            sqlx::query(
                r#"INSERT INTO processed_events (event_id, store_id)
                   VALUES ($1::uuid, $2)
                   ON CONFLICT DO NOTHING"#,
            )
            .bind(event_id)
            .bind(store_id)
            .execute(self.db.pool())
            .await
            .map(|_| ())
            .map_err(|e| IdempotencyError::DatabaseError(e.to_string()))
        };

        let (bloom_result, db_result) = tokio::join!(bloom_fut, db_fut);
        bloom_result?;
        db_result?;
        Ok(())
    }
}