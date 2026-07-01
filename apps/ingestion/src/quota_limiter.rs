//! Per-store quota limiter backed by a Redis set.
//!
//! The real-time check is a pure in-memory lookup — no Redis round-trip in the
//! hot path.  A background task polls the `quota:exceeded` Redis set and updates
//! the in-memory cache.
//!
//! ## Redis key schema
//!
//! `quota:exceeded` — Redis set, members: `"{store_id}:{bucket}"`
//!   e.g. `"42:events"`, `"42:exceptions"`, `"99:checkout"`
//!
//! Set a store over-quota:    `SADD quota:exceeded 42:events`
//! Clear it:                  `SREM quota:exceeded 42:events`
//!
//! ## Buckets
//!
//! | Bucket       | Covers                                      |
//! |--------------|---------------------------------------------|
//! | `events`     | All analytics events (default bucket)       |
//! | `exceptions` | `$exception` events                         |
//! | `checkout`   | `$checkout_*`, `order_*`, `purchase`, …     |

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;
use tracing::{debug, warn};

use crate::errors::AppError;

// ─── Bucket classification ────────────────────────────────────────────────────

/// Event-type bucket for quota accounting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuotaBucket {
    Events,
    Exceptions,
    Checkout,
}

impl QuotaBucket {
    /// Classify an event by its `t` field into a quota bucket.
    pub fn from_event_type(t: &str) -> Self {
        match t {
            "$exception" => Self::Exceptions,
            name if name.starts_with("$checkout_")
                || name.starts_with("order_")
                || name == "purchase"
                || name == "checkout_started" =>
            {
                Self::Checkout
            }
            _ => Self::Events,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Events => "events",
            Self::Exceptions => "exceptions",
            Self::Checkout => "checkout",
        }
    }
}

// ─── QuotaLimiter ─────────────────────────────────────────────────────────────

/// In-memory cache of over-quota `(store_id, bucket)` pairs.
///
/// The cache is populated by [`spawn_refresh_loop`], which periodically reads
/// the `quota:exceeded` Redis set.  Fails open: starts empty, Redis errors keep
/// the last known state.
pub struct QuotaLimiter {
    /// Cached `"{store_id}:{bucket}"` strings for O(1) lookup.
    exceeded: Arc<RwLock<HashSet<String>>>,
    pub enabled: bool,
}

impl QuotaLimiter {
    /// Create a new limiter.  The in-memory cache starts empty (fail-open)
    /// until the first background refresh completes.
    pub fn new(enabled: bool) -> Self {
        Self {
            exceeded: Arc::new(RwLock::new(HashSet::new())),
            enabled,
        }
    }

    /// Returns `true` if `store_id` has exceeded its quota for `bucket`.
    pub async fn is_exceeded(&self, store_id: u32, bucket: QuotaBucket) -> bool {
        if !self.enabled {
            return false;
        }
        let key = format!("{}:{}", store_id, bucket.as_str());
        self.exceeded.read().await.contains(&key)
    }

    /// Replace the in-memory cache with a fresh set from Redis.
    pub async fn update(&self, members: HashSet<String>) {
        *self.exceeded.write().await = members;
    }
}

// ─── Background refresh loop ─────────────────────────────────────────────────

const REDIS_QUOTA_KEY: &str = "quota:exceeded";

/// Spawn the background task that keeps the in-memory cache in sync with Redis.
///
/// The handle can be aborted to stop the loop on shutdown.
pub fn spawn_refresh_loop(
    limiter: Arc<QuotaLimiter>,
    redis: Arc<redis::Client>,
    interval_secs: u64,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
        loop {
            ticker.tick().await;
            match refresh_once(&limiter, &redis).await {
                Ok(n) => debug!(entries = n, "Quota exceeded set refreshed from Redis"),
                Err(e) => warn!(
                    error = %e,
                    "Failed to refresh quota exceeded set — keeping last known state"
                ),
            }
        }
    })
}

async fn refresh_once(
    limiter: &QuotaLimiter,
    redis: &redis::Client,
) -> Result<usize, AppError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    let members: Vec<String> = redis::cmd("SMEMBERS")
        .arg(REDIS_QUOTA_KEY)
        .query_async(&mut conn)
        .await?;
    let n = members.len();
    limiter.update(members.into_iter().collect()).await;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn disabled_limiter_never_exceeded() {
        let lim = QuotaLimiter::new(false);
        assert!(!lim.is_exceeded(1, QuotaBucket::Events).await);
        assert!(!lim.is_exceeded(1, QuotaBucket::Exceptions).await);
        assert!(!lim.is_exceeded(1, QuotaBucket::Checkout).await);
    }

    #[tokio::test]
    async fn populated_cache_matches_correctly() {
        let lim = QuotaLimiter::new(true);
        let members: HashSet<String> = ["42:events", "99:checkout"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        lim.update(members).await;

        assert!(lim.is_exceeded(42, QuotaBucket::Events).await);
        assert!(!lim.is_exceeded(42, QuotaBucket::Exceptions).await);
        assert!(!lim.is_exceeded(42, QuotaBucket::Checkout).await);
        assert!(lim.is_exceeded(99, QuotaBucket::Checkout).await);
        assert!(!lim.is_exceeded(1, QuotaBucket::Events).await);
    }

    #[tokio::test]
    async fn cache_clears_on_update() {
        let lim = QuotaLimiter::new(true);
        let first: HashSet<String> = ["7:events"].iter().map(|s| s.to_string()).collect();
        lim.update(first).await;
        assert!(lim.is_exceeded(7, QuotaBucket::Events).await);

        // Clearing the exceeded set (e.g. quota increased)
        lim.update(HashSet::new()).await;
        assert!(!lim.is_exceeded(7, QuotaBucket::Events).await);
    }

    #[test]
    fn bucket_classification() {
        assert_eq!(QuotaBucket::from_event_type("$exception"), QuotaBucket::Exceptions);
        assert_eq!(QuotaBucket::from_event_type("$checkout_started"), QuotaBucket::Checkout);
        assert_eq!(QuotaBucket::from_event_type("order_completed"), QuotaBucket::Checkout);
        assert_eq!(QuotaBucket::from_event_type("purchase"), QuotaBucket::Checkout);
        assert_eq!(QuotaBucket::from_event_type("$page_view"), QuotaBucket::Events);
        assert_eq!(QuotaBucket::from_event_type("$identify"), QuotaBucket::Events);
        assert_eq!(QuotaBucket::from_event_type("custom_event"), QuotaBucket::Events);
    }
}
