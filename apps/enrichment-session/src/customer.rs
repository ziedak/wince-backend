use std::sync::Arc;
use thiserror::Error;
use rust_postgre_client::PostgresClient;
use rust_shared_types::CustomerData;
use crate::metrics::EnrichmentMetrics;

const CUSTOMER_CACHE_TTL: u64 = 300;

#[derive(Error, Debug)]
pub enum CustomerError {
    #[error("redis error: {0}")]
    RedisError(String),
    #[error("database error: {0}")]
    DatabaseError(String),
}

pub struct CustomerService {
    redis: Arc<redis::Client>,
    db: Arc<PostgresClient>,
    metrics: Arc<EnrichmentMetrics>,
}

impl CustomerService {
    pub fn new(redis: Arc<redis::Client>, db: Arc<PostgresClient>, metrics: Arc<EnrichmentMetrics>) -> Self {
        Self { redis, db, metrics }
    }

    /// Look up or create a customer. Returns None on non-fatal errors.
    pub async fn get_or_create(&self, store_id: i32, distinct_id: &str) -> Result<Option<CustomerData>, CustomerError> {
        let cache_key = format!("cache:customer:{}:{}", store_id, distinct_id);

        // L1: Redis cache
        let mut con = self.redis.get_multiplexed_async_connection().await
            .map_err(|e| CustomerError::RedisError(e.to_string()))?;
        
        let cached: Option<String> = redis::cmd("GET")
            .arg(&cache_key)
            .query_async(&mut con)
            .await
            .map_err(|e| CustomerError::RedisError(e.to_string()))?;
        
        if let Some(cached_data) = cached {
            if let Ok(customer) = serde_json::from_str::<CustomerData>(&cached_data) {
                return Ok(Some(customer));
            }
        }

        let t0 = std::time::Instant::now();

        // L2: PostgreSQL lookup — use sqlx directly for parameterized queries
        let row = sqlx::query_as::<_, CustomerRow>(
            r#"SELECT id, email, lifetime_value, email_consent, sms_consent
               FROM customers
               WHERE store_id = $1 AND distinct_id = $2
               LIMIT 1"#,
        )
        .bind(store_id)
        .bind(distinct_id)
        .fetch_optional(self.db.pool())
        .await
        .map_err(|e| CustomerError::DatabaseError(e.to_string()))?;

        self.metrics.db_query_latency("customer_lookup", t0.elapsed().as_millis() as f64);

        let customer = if let Some(row) = row {
            Some(CustomerData {
                id: row.id,
                email: row.email,
                lifetime_value: row.lifetime_value.unwrap_or(0.0),
                email_consent: row.email_consent.unwrap_or(false),
                sms_consent: row.sms_consent.unwrap_or(false),
            })
        } else {
            // Create anonymous customer
            let created = sqlx::query_as::<_, CreatedCustomer>(
                r#"INSERT INTO customers (store_id, distinct_id)
                   VALUES ($1, $2)
                   ON CONFLICT (store_id, distinct_id) DO NOTHING
                   RETURNING id"#,
            )
            .bind(store_id)
            .bind(distinct_id)
            .fetch_optional(self.db.pool())
            .await
            .map_err(|e| CustomerError::DatabaseError(e.to_string()))?;

            created.map(|c| CustomerData {
                id: c.id,
                email: None,
                lifetime_value: 0.0,
                email_consent: false,
                sms_consent: false,
            })
        };

        // Ensure identity mapping and cache
        if let Some(ref customer) = customer {
            let _ = sqlx::query(
                r#"INSERT INTO customer_identities (store_id, customer_id, distinct_id)
                   VALUES ($1, $2, $3)
                   ON CONFLICT DO NOTHING"#,
            )
            .bind(store_id)
            .bind(customer.id)
            .bind(distinct_id)
            .execute(self.db.pool())
            .await;

            let _ = redis::cmd("SET")
                .arg(&cache_key)
                .arg(serde_json::to_string(customer).unwrap())
                .arg("EX")
                .arg(CUSTOMER_CACHE_TTL)
                .query_async::<_, ()>(&mut con)
                .await;
        }

        Ok(customer)
    }
}

// Helper structs for queries
#[derive(sqlx::FromRow)]
struct CustomerRow {
    id: i32,
    email: Option<String>,
    lifetime_value: Option<f64>,
    email_consent: Option<bool>,
    sms_consent: Option<bool>,
}

#[derive(sqlx::FromRow)]
struct CreatedCustomer {
    id: i32,
}