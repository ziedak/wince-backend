//! Per-store event restriction filter.
//!
//! Operators can block specific event types for a store without redeploying.
//! The allow/block list is stored in Redis and refreshed in the background.
//!
//! ## Redis key schema
//!
//! `restrictions:index`      — Redis SET of store IDs that have restrictions
//! `restrictions:{store_id}` — Redis SET of blocked event-type strings for that store
//!
//! To block an event type for store 42:
//!   `SADD restrictions:index 42`
//!   `SADD restrictions:42 '$exception'`
//!
//! To unblock:
//!   `SREM restrictions:42 '$exception'`
//!   `SREM restrictions:index 42`   ← once the store's set is empty
//!
//! ## Fail-open guarantee
//!
//! The in-memory cache starts empty.  If Redis is unavailable during a refresh
//! the last-known state is preserved — no events are incorrectly dropped due to
//! a transient Redis outage.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;
use tracing::{debug, warn};

use crate::errors::AppError;

const INDEX_KEY: &str = "restrictions:index";

/// In-memory cache of per-store blocked event names.
pub struct RestrictionStore {
    /// Maps `store_id` → set of blocked event-type strings.
    cache: Arc<RwLock<HashMap<u32, HashSet<String>>>>,
    pub enabled: bool,
}

impl RestrictionStore {
    /// Create a new store.  Cache starts empty (fail-open) until the first refresh.
    pub fn new(enabled: bool) -> Self {
        Self {
            cache: Arc::new(RwLock::new(HashMap::new())),
            enabled,
        }
    }

    /// Returns `true` if `event_type` is blocked for `store_id`.
    pub async fn is_restricted(&self, store_id: u32, event_type: &str) -> bool {
        if !self.enabled {
            return false;
        }
        let guard = self.cache.read().await;
        guard
            .get(&store_id)
            .is_some_and(|set| set.contains(event_type))
    }

    /// Replace the in-memory cache (called by the background refresh task).
    pub async fn update(&self, map: HashMap<u32, HashSet<String>>) {
        *self.cache.write().await = map;
    }
}

// ─── Background refresh loop ─────────────────────────────────────────────────

/// Spawn the background task that keeps the restriction cache in sync with Redis.
pub fn spawn_refresh_loop(
    store: Arc<RestrictionStore>,
    redis: Arc<redis::Client>,
    interval_secs: u64,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
        loop {
            ticker.tick().await;
            match refresh_once(&store, &redis).await {
                Ok(n) => debug!(stores = n, "Event restriction cache refreshed from Redis"),
                Err(e) => warn!(
                    error = %e,
                    "Failed to refresh event restriction cache — keeping last known state"
                ),
            }
        }
    })
}

async fn refresh_once(
    store: &RestrictionStore,
    redis: &redis::Client,
) -> Result<usize, AppError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;

    // 1. Fetch the set of store IDs that have restrictions.
    let store_ids: Vec<String> = redis::cmd("SMEMBERS")
        .arg(INDEX_KEY)
        .query_async(&mut conn)
        .await?;

    // 2. For each store, fetch its blocked event names.
    let mut map: HashMap<u32, HashSet<String>> = HashMap::new();
    for sid_str in &store_ids {
        let Ok(store_id) = sid_str.parse::<u32>() else {
            warn!(value = %sid_str, "Skipping non-u32 value in restrictions:index");
            continue;
        };
        let key = format!("restrictions:{store_id}");
        let events: Vec<String> = redis::cmd("SMEMBERS")
            .arg(&key)
            .query_async(&mut conn)
            .await?;
        if !events.is_empty() {
            map.insert(store_id, events.into_iter().collect());
        }
    }

    let n = map.len();
    store.update(map).await;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn disabled_store_never_restricts() {
        let store = RestrictionStore::new(false);
        assert!(!store.is_restricted(1, "$exception").await);
        assert!(!store.is_restricted(1, "custom_event").await);
    }

    #[tokio::test]
    async fn empty_cache_is_fail_open() {
        let store = RestrictionStore::new(true);
        assert!(!store.is_restricted(42, "$exception").await);
        assert!(!store.is_restricted(42, "any_event").await);
    }

    #[tokio::test]
    async fn populated_cache_blocks_correctly() {
        let store = RestrictionStore::new(true);
        let mut map = HashMap::new();
        let events: HashSet<String> = ["$exception", "bad_event"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        map.insert(42u32, events);
        store.update(map).await;

        assert!(store.is_restricted(42, "$exception").await);
        assert!(store.is_restricted(42, "bad_event").await);
        assert!(!store.is_restricted(42, "$page_view").await);
        assert!(!store.is_restricted(99, "$exception").await);
    }

    #[tokio::test]
    async fn cache_clears_on_update() {
        let store = RestrictionStore::new(true);
        let mut map = HashMap::new();
        map.insert(1u32, ["ev"].iter().map(|s| s.to_string()).collect());
        store.update(map).await;
        assert!(store.is_restricted(1, "ev").await);

        store.update(HashMap::new()).await;
        assert!(!store.is_restricted(1, "ev").await);
    }
}
