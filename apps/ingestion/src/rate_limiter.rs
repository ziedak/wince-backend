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
use std::sync::atomic::{AtomicU64, Ordering};

use governor::clock::DefaultClock;
use governor::state::keyed::DashMapStateStore;
use governor::{Quota, RateLimiter};
use tracing::warn;

type DashLimiter<K> = RateLimiter<K, DashMapStateStore<K>, DefaultClock>;

// ─── Per-store HTTP rate limiter ─────────────────────────────────────────────

pub struct StoreLimiter {
    limiter: Arc<DashLimiter<u32>>,
    enabled: bool,
    /// When `true`, state is tracked and metrics are emitted but no request is
    /// ever rejected — useful for shadow-testing a limit before enforcing it.
    dry_run: bool,
}

impl StoreLimiter {
    pub fn new(per_second: NonZeroU32, burst: NonZeroU32, enabled: bool, dry_run: bool) -> Self {
        let quota = Quota::per_second(per_second).allow_burst(burst);
        Self {
            limiter: Arc::new(RateLimiter::dashmap(quota)),
            enabled,
            dry_run,
        }
    }

    /// Returns `true` when `store_id` has exhausted its token bucket.
    /// Always returns `false` in dry-run mode (but still emits a metric).
    pub fn is_limited(&self, store_id: u32) -> bool {
        if !self.enabled {
            return false;
        }
        let limited = self.limiter.check_key(&store_id).is_err();
        if limited && self.dry_run {
            metrics::counter!("ingestion_rate_limit_dry_run_total", "limiter" => "store")
                .increment(1);
            return false;
        }
        limited
    }
}

// ─── Per-(store, anon) hot-partition overflow limiter ────────────────────────

pub struct OverflowLimiter {
    limiter: Arc<DashLimiter<String>>,
    enabled: bool,
    dry_run: bool,
}

impl OverflowLimiter {
    pub fn new(per_second: NonZeroU32, burst: NonZeroU32, enabled: bool, dry_run: bool) -> Self {
        let quota = Quota::per_second(per_second).allow_burst(burst);
        Self {
            limiter: Arc::new(RateLimiter::dashmap(quota)),
            enabled,
            dry_run,
        }
    }

    /// Returns `true` when the `(store_id, anon)` key is a hot partition.
    pub fn is_hot_key(&self, store_id: u32, anon: &str) -> bool {
        if !self.enabled {
            return false;
        }
        let key = format!("{store_id}:{anon}");
        let hot = self.limiter.check_key(&key).is_err();
        if hot && self.dry_run {
            metrics::counter!("ingestion_rate_limit_dry_run_total", "limiter" => "overflow")
                .increment(1);
            return false;
        }
        hot
    }
}

// ─── Distributed per-store rate limiter (Redis sliding window) ────────────────

/// Sliding-window request counter backed by Redis.
///
/// Uses an atomic Lua script so window evaluation and counter increment happen
/// in a single round-trip with no race conditions across replicas.
///
/// Key schema: `ratelimit:store:{store_id}` (sorted set, score = timestamp ms)
///
/// Fails open: if Redis is unavailable the request is allowed through and the
/// `ingestion_rate_limit_redis_error_total` counter is incremented.
pub struct DistributedStoreLimiter {
    redis: Arc<redis::Client>,
    /// Maximum requests allowed within `window_ms`.
    limit: u64,
    /// Sliding window width in milliseconds (default 1 000 = 1 s).
    window_ms: u64,
    enabled: bool,
    dry_run: bool,
}

/// Per-process monotonic counter for unique sorted-set members.
static REQUEST_SEQ: AtomicU64 = AtomicU64::new(0);

/// Atomic Lua sliding-window script.
///
/// KEYS[1]: sorted-set key
/// ARGV[1]: current timestamp (ms)  ARGV[2]: window width (ms)
/// ARGV[3]: limit  ARGV[4]: unique member
///
/// Returns 0 if allowed, 1 if rate-limited.
const SLIDING_WINDOW_LUA: &str = r#"
local key   = KEYS[1]
local now   = tonumber(ARGV[1])
local win   = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local mem   = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - win)
local count = redis.call('ZCARD', key)
if count < limit then
    redis.call('ZADD', key, now, mem)
    redis.call('PEXPIRE', key, win + 1000)
    return 0
else
    return 1
end
"#;

impl DistributedStoreLimiter {
    pub fn new(redis: Arc<redis::Client>, limit: u64, enabled: bool, dry_run: bool) -> Self {
        Self { redis, limit, window_ms: 1_000, enabled, dry_run }
    }

    /// Check and (when not rate-limited) record this request in the Redis
    /// sliding window.  Fails open when Redis is unavailable.
    pub async fn is_limited(&self, store_id: u32) -> bool {
        if !self.enabled {
            return false;
        }
        match self.check_redis(store_id).await {
            Ok(true) => {
                if self.dry_run {
                    metrics::counter!(
                        "ingestion_rate_limit_dry_run_total",
                        "limiter" => "distributed"
                    )
                    .increment(1);
                    false
                } else {
                    true
                }
            }
            Ok(false) => false,
            Err(e) => {
                warn!(
                    error = %e,
                    store_id,
                    "Distributed rate limit Redis check failed — failing open"
                );
                metrics::counter!("ingestion_rate_limit_redis_error_total").increment(1);
                false
            }
        }
    }

    async fn check_redis(&self, store_id: u32) -> Result<bool, redis::RedisError> {
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        let key = format!("ratelimit:store:{store_id}");
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let seq = REQUEST_SEQ.fetch_add(1, Ordering::Relaxed);
        let member = format!("{now_ms}:{seq}");

        let result: i64 = redis::Script::new(SLIDING_WINDOW_LUA)
            .key(&key)
            .arg(now_ms)
            .arg(self.window_ms)
            .arg(self.limit)
            .arg(&member)
            .invoke_async(&mut conn)
            .await?;

        Ok(result == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_limiter_disabled_never_limited() {
        let lim = StoreLimiter::new(
            NonZeroU32::new(1).unwrap(),
            NonZeroU32::new(1).unwrap(),
            false, // disabled
            false,
        );
        for _ in 0..20 {
            assert!(!lim.is_limited(1));
        }
    }

    #[test]
    fn store_limiter_dry_run_never_rejects() {
        // Burst of 1 — bucket is exhausted after the first successful check.
        let lim = StoreLimiter::new(
            NonZeroU32::new(1).unwrap(),
            NonZeroU32::new(1).unwrap(),
            true, // enabled
            true, // dry_run
        );
        for _ in 0..10 {
            assert!(!lim.is_limited(42));
        }
    }

    #[tokio::test]
    async fn distributed_limiter_disabled_never_limited() {
        // Client::open only parses the URL — no connection is made here.
        let client = redis::Client::open("redis://127.0.0.1:6379").unwrap();
        let lim = DistributedStoreLimiter::new(Arc::new(client), 100, false, false);
        assert!(!lim.is_limited(1).await);
    }
}
