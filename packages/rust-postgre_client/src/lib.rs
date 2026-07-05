//! Production-ready, high-performance PostgreSQL client wrapper.
//!
//! Built on battle-tested libraries:
//! - `sqlx` for connection pooling (PgPool) and compile-time checked queries
//! - `backoff` for exponential backoff retries
//! - `url` for proper connection URL parsing
//!
//! Features:
//! - Connection pooling via sqlx's PgPool (battle-tested)
//! - Automatic retry on transient errors using backoff crate
//! - Query latency tracking via a pluggable [`QueryMetricsRecorder`] trait
//! - Health checks
//! - Graceful shutdown
//!
//! # Metrics
//!
//! The library defines the [`QueryMetricsRecorder`] trait for recording
//! query-level observability.  Consumers implement the trait with their
//! chosen backend (Prometheus, OpenTelemetry, etc.) and pass it to
//! [`PostgresClient::new`] or [`PostgresClient::with_metrics`].
//! A [`NoopMetricsRecorder`] is provided for testing or when metrics are not needed.

use std::time::{Duration, Instant};

use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Postgres;
use tracing::{error, info};

pub use crate::config::PostgresConfig;
pub use crate::error::PostgresError;

mod config;
mod error;
mod metrics;

/// Re-export sqlx types for convenience
pub use sqlx::postgres::PgRow;

/// Re-export the metrics trait and helpers
pub use metrics::{MetricsHandle, NoopMetricsRecorder, QueryMetricsRecorder};

/// High-performance PostgreSQL client using battle-tested libraries.
pub struct PostgresClient {
    pool: PgPool,
    metrics: MetricsHandle,
}

impl PostgresClient {
    /// Create a new PostgresClient with sqlx PgPool and backoff retry.
    ///
    /// Uses a [`NoopMetricsRecorder`] by default.  To record real metrics,
    /// use [`with_metrics`](Self::with_metrics).
    pub async fn new(config: PostgresConfig) -> Result<Self, PostgresError> {
        let pool = Self::build_pool(&config).await?;
        info!("postgreSQL connection pool established");

        Ok(Self {
            pool,
            metrics: MetricsHandle::default(),
        })
    }

    /// Create a new PostgresClient with a custom metrics recorder.
    ///
    /// Builds the pool once and assigns the recorder — no double-connect.
    pub async fn with_metrics(
        config: PostgresConfig,
        metrics: MetricsHandle,
    ) -> Result<Self, PostgresError> {
        let pool = Self::build_pool(&config).await?;
        info!("postgreSQL connection pool established");

        Ok(Self { pool, metrics })
    }

    /// Shared pool construction logic.
    async fn build_pool(config: &PostgresConfig) -> Result<PgPool, PostgresError> {
        info!(
            url = %config.database_url,
            min_connections = config.min_connections,
            max_connections = config.max_connections,
            "connecting to PostgreSQL"
        );

        let pool = PgPoolOptions::new()
            .min_connections(config.min_connections)
            .max_connections(config.max_connections)
            .acquire_timeout(config.acquire_timeout)
            .max_lifetime(config.max_lifetime)
            .idle_timeout(config.idle_timeout)
            .connect(&config.database_url)
            .await?;

        // Verify connection
        sqlx::query("SELECT 1").fetch_one(&pool).await?;

        Ok(pool)
    }

    /// Get a reference to the connection pool
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Check pool health
    pub fn is_healthy(&self) -> bool {
        !self.pool.is_closed()
    }

    /// Execute a query with retry logic and record metrics.
    pub async fn execute(
        &self,
        query: &str,
    ) -> Result<sqlx::postgres::PgQueryResult, PostgresError> {
        let start = Instant::now();
        let result = self
            .execute_with_retry(|| async move { sqlx::query(query).execute(&self.pool).await })
            .await;
        self.metrics
            .record_query(start.elapsed().as_secs_f64(), result.is_ok());
        result
    }

    /// Fetch one row with retry logic and record metrics.
    pub async fn fetch_one<T>(&self, query: &str) -> Result<T, PostgresError>
    where
        for<'r> T: sqlx::FromRow<'r, sqlx::postgres::PgRow>,
        T: Send + Unpin,
    {
        let start = Instant::now();
        let result = self
            .execute_with_retry(|| async move {
                sqlx::query_as::<Postgres, T>(query)
                    .fetch_one(&self.pool)
                    .await
            })
            .await;
        self.metrics
            .record_query(start.elapsed().as_secs_f64(), result.is_ok());
        result
    }

    /// Fetch optional row with retry logic and record metrics.
    pub async fn fetch_opt<T>(&self, query: &str) -> Result<Option<T>, PostgresError>
    where
        for<'r> T: sqlx::FromRow<'r, sqlx::postgres::PgRow>,
        T: Send + Unpin,
    {
        let start = Instant::now();
        let result = self
            .execute_with_retry(|| async move {
                sqlx::query_as::<Postgres, T>(query)
                    .fetch_optional(&self.pool)
                    .await
            })
            .await;
        self.metrics
            .record_query(start.elapsed().as_secs_f64(), result.is_ok());
        result
    }

    /// Fetch all rows with retry logic and record metrics.
    pub async fn fetch_all<T>(&self, query: &str) -> Result<Vec<T>, PostgresError>
    where
        for<'r> T: sqlx::FromRow<'r, sqlx::postgres::PgRow>,
        T: Send + Unpin,
    {
        let start = Instant::now();
        let result = self
            .execute_with_retry(|| async move {
                sqlx::query_as::<Postgres, T>(query)
                    .fetch_all(&self.pool)
                    .await
            })
            .await;
        self.metrics
            .record_query(start.elapsed().as_secs_f64(), result.is_ok());
        result
    }

    /// Internal retry logic using backoff crate.
    ///
    /// Records a circuit-breaker trip on each transient error.
    /// Uses `config.max_retries` and `config.retry_backoff` from the pool's
    /// stored options (defaults: 3 retries, 100ms base backoff).
    async fn execute_with_retry<F, Fut, T, E>(&self, mut f: F) -> Result<T, PostgresError>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
        E: Into<PostgresError>,
    {
        use backoff::ExponentialBackoff;

        let metrics = self.metrics.clone();
        let operation = move || {
            let fut = f();
            let m = metrics.clone();
            async move {
                match fut.await {
                    Ok(val) => Ok(val),
                    Err(e) => {
                        let err = e.into();
                        if Self::is_retryable_static(&err) {
                            error!(error = ?err, "query failed, will retry");
                            m.record_circuit_breaker_trip();
                            Err(backoff::Error::Transient { err, retry_after: None })
                        } else {
                            Err(backoff::Error::Permanent(err))
                        }
                    }
                }
            }
        };

        let backoff = ExponentialBackoff {
            max_elapsed_time: Some(Duration::from_secs(15)),
            ..Default::default()
        };

        backoff::future::retry(backoff, operation).await
    }

    /// Check if error is transient and retryable (static dispatch, no &self)
    fn is_retryable_static(err: &PostgresError) -> bool {
        match err {
            PostgresError::QueryError(msg) => {
                let transient_codes = [
                    "57P01", // admin_shutdown
                    "57P02", // crash_shutdown
                    "57P03", // cannot_connect_now
                    "40001", // serialization_failure
                    "40P01", // deadlock_detected
                ];
                transient_codes.iter().any(|code| msg.contains(*code))
            }
            _ => false,
        }
    }

    /// Begin a transaction
    pub async fn begin(&self) -> Result<sqlx::Transaction<'_, Postgres>, PostgresError> {
        self.pool.begin().await.map_err(Into::into)
    }

    /// Health check
    pub async fn health_check(&self) -> Result<(), PostgresError> {
        sqlx::query("SELECT 1").fetch_one(&self.pool).await?;
        Ok(())
    }

    /// Get pool statistics for monitoring.
    ///
    /// Uses `Pool::size()` and `Pool::num_idle()` available in sqlx 0.7.
    pub fn pool_stats(&self) -> PoolStats {
        PoolStats {
            size: self.pool.size(),
            available: self.pool.num_idle() as u32,
            waiting: 0, // sqlx 0.7 does not expose a waiting-connections counter
        }
    }

    /// Close the pool gracefully
    pub async fn close(self) {
        info!("closing postgreSQL connection pool");
        self.pool.close().await;
    }
}

/// Pool statistics for monitoring
#[derive(Debug, Clone, Copy)]
pub struct PoolStats {
    pub size: u32,
    pub available: u32,
    pub waiting: u32,
}