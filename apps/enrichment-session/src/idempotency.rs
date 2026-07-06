//! Session window service — single atomic Lua round-trip per event.
//! Loaded as `mod window` via `#[path = "idempotency.rs"]` in main.rs.
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;
use redis::Value as RedisValue;
use crate::metrics::EnrichmentMetrics;
use rust_shared_types::{FeatureVector, RawEvent};
use rust_redis_client::RedisClient;

pub const FEATURE_SCHEMA_VERSION: &str = "v1";

static WINDOW_LUA: &str = r#"
local now_ms   = tonumber(ARGV[2])
local etype    = ARGV[3]
local now_s    = tonumber(ARGV[4])
local win_ttl  = tonumber(ARGV[5])
local sess_ttl = tonumber(ARGV[6])
local idem_ttl = tonumber(ARGV[7])
local alpha    = tonumber(ARGV[8])
local scroll_v = tonumber(ARGV[9]  or '0')
local cart_v   = tonumber(ARGV[10] or '0')

-- Idempotency check: SETNX returns 0 if key already exists (duplicate)
if redis.call('SETNX', KEYS[2], '1') == 0 then return {0} end
redis.call('EXPIRE', KEYS[2], idem_ttl)

local cutoff_ms = (now_s - win_ttl) * 1000

-- Main window sorted set (all events)
redis.call('ZADD',             KEYS[1], now_ms, ARGV[1])
redis.call('EXPIRE',           KEYS[1], win_ttl)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff_ms)

-- Per-type sorted sets (rage_click / add_to_cart / exit_intent)
if etype == 'rage_click' then
    redis.call('ZADD',             KEYS[4], now_ms, ARGV[1])
    redis.call('EXPIRE',           KEYS[4], win_ttl)
    redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', cutoff_ms)
elseif etype == 'add_to_cart' then
    redis.call('ZADD',             KEYS[5], now_ms, ARGV[1])
    redis.call('EXPIRE',           KEYS[5], win_ttl)
    redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', cutoff_ms)
elseif etype == 'exit_intent' then
    redis.call('ZADD',             KEYS[6], now_ms, ARGV[1])
    redis.call('EXPIRE',           KEYS[6], win_ttl)
    redis.call('ZREMRANGEBYSCORE', KEYS[6], '-inf', cutoff_ms)
end

-- HyperLogLog for unique event types
redis.call('PFADD',  KEYS[7], etype)
redis.call('EXPIRE', KEYS[7], win_ttl)
local ue  = redis.call('PFCOUNT', KEYS[7])

-- Rolling window aggregates
local r30 = redis.call('ZCOUNT', KEYS[4], now_ms - 30000,  '+inf')
local a60 = redis.call('ZCOUNT', KEYS[5], now_ms - 60000,  '+inf')
local e5m = redis.call('ZCOUNT', KEYS[6], now_ms - 300000, '+inf')

-- Recency features (seconds since last event / last add)
local prev_last = tonumber(redis.call('HGET', KEYS[3], 'last_event_ts') or '0')
local sle = -1.0
if prev_last > 0 then sle = (now_ms - prev_last) / 1000.0 end

local last_add = tonumber(redis.call('HGET', KEYS[3], 'last_add_ts') or '0')
local sla = -1.0
if last_add > 0 then sla = (now_ms - last_add) / 1000.0 end

-- Update session hash timestamps
redis.call('HSET', KEYS[3], 'last_event_ts', now_ms)
if etype == 'add_to_cart' then
    redis.call('HSET', KEYS[3], 'last_add_ts', now_ms)
    last_add = now_ms
    if cart_v > 100 then
        redis.call('HSET', KEYS[3], 'last_high_cart_add_ts', now_ms)
    end
elseif etype == 'checkout_start' then
    redis.call('HSET', KEYS[3], 'last_checkout_start_ts', now_ms)
elseif etype == 'rage_click' then
    redis.call('HSET', KEYS[3], 'last_rage_ts', now_ms)
end

-- EWMA: events per minute
local epm          = redis.call('ZCOUNT', KEYS[1], now_ms - 60000, '+inf')
local prev_ewma_e  = tonumber(redis.call('HGET', KEYS[3], 'ewma_epm') or '0')
local new_ewma_e   = alpha * epm + (1 - alpha) * prev_ewma_e
redis.call('HSET', KEYS[3], 'ewma_epm', tostring(new_ewma_e))

-- EWMA: scroll velocity (passed as ARGV)
local prev_ewma_s  = tonumber(redis.call('HGET', KEYS[3], 'ewma_sv') or '0')
local new_ewma_s   = alpha * scroll_v + (1 - alpha) * prev_ewma_s
redis.call('HSET', KEYS[3], 'ewma_sv', tostring(new_ewma_s))

-- Read pattern-detection timestamps
local last_checkout = tonumber(redis.call('HGET', KEYS[3], 'last_checkout_start_ts') or '0')
local last_hca      = tonumber(redis.call('HGET', KEYS[3], 'last_high_cart_add_ts')   or '0')

-- Intervention history (written by Decision Engine, read here)
local ic  = tonumber(redis.call('HGET', KEYS[3], 'interventions_count')  or '0')
local li  = tonumber(redis.call('HGET', KEYS[3], 'last_intervention_ts') or '0')
local sli = -1.0
if li > 0 then sli = (now_ms - li) / 1000.0 end

redis.call('EXPIRE', KEYS[3], sess_ttl)

-- Return bulk: [1, r30, a60, e5m, ue, sle, sla, ewma_e, ewma_s,
--               last_add_ts, last_checkout_ts, last_hca_ts, ic, sli]
-- Floats are returned as strings to prevent Lua integer truncation.
return {
    1, r30, a60, e5m, ue,
    tostring(sle),      tostring(sla),
    tostring(new_ewma_e), tostring(new_ewma_s),
    tostring(last_add), tostring(last_checkout), tostring(last_hca),
    ic, tostring(sli),
}
"#;

#[derive(Debug, Error)]
pub enum WindowError {
    #[error("Redis error: {0}")]
    Redis(String),
}

pub enum WindowResult {
    Duplicate,
    Features(FeatureVector),
}

pub struct WindowService {
    redis: Arc<RedisClient>,
    window_ttl: u64,
    session_ttl: u64,
    idem_ttl: u64,
    ewma_alpha: f64,
    metrics: Arc<EnrichmentMetrics>,
    script: redis::Script,
}

impl WindowService {
    pub fn new(
        redis: Arc<RedisClient>,
        window_ttl: u64,
        session_ttl: u64,
        idem_ttl: u64,
        ewma_alpha: f64,
        metrics: Arc<EnrichmentMetrics>,
    ) -> Self {
        Self {
            redis,
            window_ttl,
            session_ttl,
            idem_ttl,
            ewma_alpha,
            metrics,
            script: redis::Script::new(WINDOW_LUA),
        }
    }

    pub async fn update(&self, raw: &RawEvent) -> Result<WindowResult, WindowError> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let now_s = now_ms / 1000;
        let sid = &raw.session_id;
        let eid = &raw.event_id;
        let scroll_velocity = raw
            .properties
            .as_ref()
            .and_then(|p| p.get("scroll_velocity"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let cart_value = raw.cart_value.unwrap_or(0.0);

        // 7 KEYS passed to Lua (KEYS[1] through KEYS[7])
        let keys = [
            format!("session:window:{sid}"),   // KEYS[1] main event sorted set
            format!("session:seen:{eid}"),      // KEYS[2] idempotency SETNX key
            format!("session:{sid}"),           // KEYS[3] session hash (EWMA + timestamps)
            format!("session:w:{sid}:rc"),      // KEYS[4] rage_click sorted set
            format!("session:w:{sid}:ac"),      // KEYS[5] add_to_cart sorted set
            format!("session:w:{sid}:ei"),      // KEYS[6] exit_intent sorted set
            format!("session:types:{sid}"),     // KEYS[7] HyperLogLog unique event types
        ];

        // 10 ARGVs: eid, now_ms, etype, now_s, win_ttl, sess_ttl, idem_ttl, alpha, scroll_v, cart_v
        let args: Vec<String> = vec![
            eid.clone(),
            now_ms.to_string(),
            raw.event_type.clone(),
            now_s.to_string(),
            self.window_ttl.to_string(),
            self.session_ttl.to_string(),
            self.idem_ttl.to_string(),
            format!("{:.4}", self.ewma_alpha),
            format!("{:.4}", scroll_velocity),
            format!("{:.4}", cart_value),
        ];

        let t0 = Instant::now();
        let raw_result = self
            .redis
            .invoke_script(&self.script, &keys, &args)
            .await
            .map_err(|e| WindowError::Redis(e.to_string()))?;

        let elapsed_ms = t0.elapsed().as_millis() as f64;
        self.metrics.redis_latency("lua_window", elapsed_ms);
        self.metrics.feature_extraction_time(elapsed_ms);

        let values = match raw_result {
            RedisValue::Bulk(v) => v,
            _ => return Err(WindowError::Redis("unexpected Lua response shape".into())),
        };
        Ok(parse_result(values, &raw.event_type, now_ms))
    }
}

fn parse_result(values: Vec<RedisValue>, event_type: &str, now_ms: i64) -> WindowResult {
    match values.first() {
        Some(RedisValue::Int(0)) => return WindowResult::Duplicate,
        Some(RedisValue::Int(1)) => {}
        _ => return WindowResult::Duplicate,
    }

    let rage_clicks_30s    = get_int(&values, 1);
    let add_to_cart_60s    = get_int(&values, 2);
    let exit_intent_5m     = get_int(&values, 3);
    let unique_event_types = get_int(&values, 4);
    let sle                = get_fstr(&values, 5);
    let sla                = get_fstr(&values, 6);
    let ewma_events_per_minute = get_fstr(&values, 7).max(0.0);
    let ewma_scroll_velocity   = get_fstr(&values, 8).max(0.0);
    let last_add_ts_ms         = get_fstr(&values, 9) as i64;
    let last_checkout_ts_ms    = get_fstr(&values, 10) as i64;
    let last_hca_ts_ms         = get_fstr(&values, 11) as i64;
    let interventions_shown    = get_int(&values, 12);
    let sli                    = get_fstr(&values, 13);

    let rage_after_add      = event_type == "rage_click"
        && last_add_ts_ms > 0
        && (now_ms - last_add_ts_ms) <= 10_000;
    let exit_after_checkout = event_type == "exit_intent"
        && last_checkout_ts_ms > 0
        && (now_ms - last_checkout_ts_ms) <= 30_000;
    let idle_after_high_cart = event_type == "idle_timeout" && last_hca_ts_ms > 0;

    WindowResult::Features(FeatureVector {
        rage_clicks_30s,
        add_to_cart_60s,
        exit_intent_5m,
        seconds_since_last_event: opt_f64(sle),
        seconds_since_last_add: opt_f64(sla),
        ewma_events_per_minute,
        ewma_scroll_velocity,
        rage_after_add,
        exit_after_checkout,
        idle_after_high_cart,
        unique_event_types,
        interventions_shown_this_session: interventions_shown,
        seconds_since_last_intervention: opt_f64(sli),
        cart_item_count: None,
        cart_avg_item_price: None,
        cart_has_discount: None,
        cart_distinct_categories: None,
        checkout_step_reached: None,
        unique_pages_visited: None,
        feature_schema_version: FEATURE_SCHEMA_VERSION.to_string(),
    })
}

#[inline]
fn get_int(values: &[RedisValue], idx: usize) -> i64 {
    match values.get(idx) {
        Some(RedisValue::Int(n)) => *n,
        Some(RedisValue::Data(d)) => String::from_utf8_lossy(d).parse().unwrap_or(0),
        _ => 0,
    }
}

#[inline]
fn get_fstr(values: &[RedisValue], idx: usize) -> f64 {
    match values.get(idx) {
        Some(RedisValue::Data(d)) => String::from_utf8_lossy(d).parse().unwrap_or(-1.0),
        Some(RedisValue::Int(n)) => *n as f64,
        _ => -1.0,
    }
}

#[inline]
fn opt_f64(v: f64) -> Option<f64> {
    if v < 0.0 { None } else { Some(v) }
}
