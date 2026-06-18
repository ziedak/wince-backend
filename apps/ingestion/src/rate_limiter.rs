//! In-process rate limiters backed by `governor` (token bucket algorithm).
//!
//! Two independent limiters are provided:
//!
//! * [`StoreLimiter`] — keyed on `store_id`; used in the HTTP handler to
//!   return 429 before the event enters the pipeline.
//!
//! * [`OverflowLimiter`] — keyed on `"store_id:anon_id"`; used inside the
//!   pipeline to detect hot partitions and reroute them to the overflow topic
//!   so downstream consumers are not starved by a single noisy client.

use std::num::NonZeroU32;
use std::sync::Arc;

use governor::clock::DefaultClock;
use governor::state::keyed::DashMapStateStore;
use governor::{Quota, RateLimiter};

type DashLimiter<K> = RateLimiter<K, DashMapStateStore<K>, DefaultClock>;

// ─── Per-store HTTP rate limiter ─────────────────────────────────────────────

pub struct StoreLimiter {
    limiter: Arc<DashLimiter<u32>>,
    enabled: bool,
}

impl StoreLimiter {
    pub fn new(per_second: NonZeroU32, burst: NonZeroU32, enabled: bool) -> Self {
        let quota = Quota::per_second(per_second).allow_burst(burst);
        Self {
            limiter: Arc::new(RateLimiter::dashmap(quota)),
            enabled,
        }
    }

    /// Returns `true` when `store_id` has exhausted its token bucket and should
    /// receive a 429 response.
    pub fn is_limited(&self, store_id: u32) -> bool {
        if !self.enabled {
            return false;
        }
        self.limiter.check_key(&store_id).is_err()
    }
}

// ─── Per-(store, anon) hot-partition overflow limiter ────────────────────────

pub struct OverflowLimiter {
    limiter: Arc<DashLimiter<String>>,
    enabled: bool,
}

impl OverflowLimiter {
    pub fn new(per_second: NonZeroU32, burst: NonZeroU32, enabled: bool) -> Self {
        let quota = Quota::per_second(per_second).allow_burst(burst);
        Self {
            limiter: Arc::new(RateLimiter::dashmap(quota)),
            enabled,
        }
    }

    /// Returns `true` when the `(store_id, anon)` key is a hot partition.
    /// Hot events should be produced to the overflow topic without a partition
    /// key so Kafka round-robins them across all partitions.
    pub fn is_hot_key(&self, store_id: u32, anon: &str) -> bool {
        if !self.enabled {
            return false;
        }
        let key = format!("{store_id}:{anon}");
        self.limiter.check_key(&key).is_err()
    }
}
