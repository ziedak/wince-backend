use std::time::Duration;
use thiserror::Error;

/// Errors that can occur when using the Postgres client.
#[derive(Error, Debug)]
pub enum PostgresError {
    #[error("pool error: {0}")]
    PoolError(String),

    #[error("query error: {0}")]
    QueryError(String),

    #[error("connection error: {0}")]
    ConnectionError(String),

    #[error("circuit breaker open - too many failures")]
    CircuitBreakerOpen,

    #[error("query timeout after {0:?}")]
    Timeout(Duration),
}

impl From<sqlx::Error> for PostgresError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::PoolTimedOut => PostgresError::PoolError("pool timed out".into()),
            sqlx::Error::PoolClosed => PostgresError::PoolError("pool closed".into()),
            _ => PostgresError::QueryError(err.to_string()),
        }
    }
}
