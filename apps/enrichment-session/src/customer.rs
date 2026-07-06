use std::sync::Arc;
use thiserror::Error;
use rust_postgre_client::PostgresClient;
use rust_shared_types::CustomerData;
use crate::metrics::EnrichmentMetrics;
use rust_redis_client::RedisClient;

const CUSTOMER_CACHE_TTL: u64 = 300;

#[derive(Error, Debug)]
pub enum CustomerError {
    #[error("database error: {0}")]
    DatabaseError(String),
}

pub struct CustomerService {
    redis: Arc<RedisClient>,
    db: Arc<PostgresClient>,
    metrics: Arc<EnrichmentMetrics>,
}

impl CustomerService {
    pub fn new(redis: Arc<RedisClient>, db: Arc<PostgresClient>, metrics: Arc<EnrichmentMetrics>) -> Self {
        Self { redis, db, metrics }
    }

    /// Look up or create a customer. Returns None on non-fatal errors.
    pub async fn get_or_create(&self, store_id: i32, distinct_id: &str) -> Result<Option<CustomerData>, CustomerError> {
        let cache_key = format!("cache:customer:{}:{}", store_id, distinct_id);

        // L1: Redis cache
        if let Ok(Some(customer)) = self.redis.get_json::<CustomerData>(&cache_key).await {
            return Ok(Some(customer));
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
            // No existing customer — try to insert a new anonymous one.
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

            if let Some(c) = created {
                Some(CustomerData {
                    id: c.id,
                    email: None,
                    lifetime_value: 0.0,
                    email_consent: false,
                    sms_consent: false,
                })
            } else {
                // ON CONFLICT: another instance won the race — fetch the existing row.
                sqlx::query_as::<_, CustomerRow>(
                    r#"SELECT id, email, lifetime_value, email_consent, sms_consent
                       FROM customers
                       WHERE store_id = $1 AND distinct_id = $2
                       LIMIT 1"#,
                )
                .bind(store_id)
                .bind(distinct_id)
                .fetch_optional(self.db.pool())
                .await
                .map_err(|e| CustomerError::DatabaseError(e.to_string()))?
                .map(|row| CustomerData {
                    id: row.id,
                    email: row.email,
                    lifetime_value: row.lifetime_value.unwrap_or(0.0),
                    email_consent: row.email_consent.unwrap_or(false),
                    sms_consent: row.sms_consent.unwrap_or(false),
                })
            }
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

            let _ = self.redis.set_json(&cache_key, customer, Some(CUSTOMER_CACHE_TTL)).await;
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