use std::time::Duration;
use url::Url;

/// Configuration for the PostgreSQL client.
#[derive(Debug, Clone)]
pub struct PostgresConfig {
    /// Database URL (properly parsed with url crate)
    pub database_url: String,

    /// Minimum connections (default: 5)
    pub min_connections: u32,

    /// Maximum connections (default: 20)
    pub max_connections: u32,

    /// Connection acquire timeout (default: 5s)
    pub acquire_timeout: Duration,

    /// Max connection lifetime (default: 30m)
    pub max_lifetime: Duration,

    /// Idle timeout (default: 10m)
    pub idle_timeout: Duration,

    /// Statement timeout (default: 30s)
    pub statement_timeout: Duration,

    /// Circuit breaker failure threshold (default: 5)
    pub circuit_breaker_threshold: u32,

    /// Circuit breaker reset timeout (default: 60s)
    pub circuit_breaker_reset: Duration,

    /// Max retries for transient errors (default: 3)
    pub max_retries: u32,

    /// Retry backoff base (default: 100ms)
    pub retry_backoff: Duration,
}

impl Default for PostgresConfig {
    fn default() -> Self {
        Self {
            database_url: String::new(),
            min_connections: 5,
            max_connections: 20,
            acquire_timeout: Duration::from_secs(5),
            max_lifetime: Duration::from_secs(1800),
            idle_timeout: Duration::from_secs(600),
            statement_timeout: Duration::from_secs(30),
            circuit_breaker_threshold: 5,
            circuit_breaker_reset: Duration::from_secs(60),
            max_retries: 3,
            retry_backoff: Duration::from_millis(100),
        }
    }
}

impl PostgresConfig {
    /// Create config from URL (validates with url crate)
    pub fn new(database_url: impl Into<String>) -> Result<Self, PostgresConfigError> {
        let url = database_url.into();
        // Validate URL format
        Url::parse(&url).map_err(|e| PostgresConfigError::InvalidUrl(e.to_string()))?;

        Ok(Self {
            database_url: url,
            ..Default::default()
        })
    }

    /// Set pool size
    pub fn with_pool_size(mut self, min: u32, max: u32) -> Self {
        self.min_connections = min;
        self.max_connections = max;
        self
    }

    /// Set timeouts
    pub fn with_timeouts(mut self, acquire: Duration, statement: Duration) -> Self {
        self.acquire_timeout = acquire;
        self.statement_timeout = statement;
        self
    }

    /// Configure retries
    pub fn with_retries(mut self, max: u32, backoff: Duration) -> Self {
        self.max_retries = max;
        self.retry_backoff = backoff;
        self
    }

    /// Configure circuit breaker
    pub fn with_circuit_breaker(mut self, threshold: u32, reset: Duration) -> Self {
        self.circuit_breaker_threshold = threshold;
        self.circuit_breaker_reset = reset;
        self
    }
}

/// Configuration error
#[derive(Debug, thiserror::Error)]
pub enum PostgresConfigError {
    #[error("invalid database URL: {0}")]
    InvalidUrl(String),
}
