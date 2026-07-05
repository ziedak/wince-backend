use std::sync::Arc;
use thiserror::Error;

const RAGE_WINDOW_MS: i64 = 30_000;
const RAGE_THRESHOLD: i32 = 3;
const MAX_RAGE_TIMESTAMPS: usize = 10;

#[derive(Error, Debug)]
pub enum SessionError {
    #[error("Redis error: {0}")]
    RedisError(String),
}

#[derive(Debug, Clone)]
pub struct SessionContext {
    pub store_id: i32,
    pub customer_id: Option<i32>,
    pub distinct_id: String,
    /// Anonymous visitor ID alias — falls back to distinct_id if not set.
    pub anon: Option<String>,
    /// Authenticated user ID (empty string when not authenticated).
    pub uid: Option<String>,
    pub email: Option<String>,
    pub email_consent: bool,
    pub sms_consent: bool,
}

pub struct SessionService {
    redis: Arc<redis::Client>,
    ttl_seconds: u64,
}

impl SessionService {
    pub fn new(redis: Arc<redis::Client>, ttl_seconds: u64) -> Self {
        Self { redis, ttl_seconds }
    }

    /// Update session with new event and return current session state.
    pub async fn update_session(
        &self,
        session_id: &str,
        event_type: &str,
        cart_value_delta: f64,
        now_ms: i64,
    ) -> Result<SessionState, SessionError> {
        let mut con = self.redis.get_multiplexed_async_connection().await
            .map_err(|e| SessionError::RedisError(e.to_string()))?;

        let session_key = format!("session:{}", session_id);
        let rage_ts_key = format!("session:{}:rage_ts", session_id);
        let is_rage_click = event_type == "rage_click";

        let mut pipe = redis::pipe();
        if cart_value_delta != 0.0 {
            pipe.cmd("HINCRBYFLOAT")
                .arg(&session_key)
                .arg("cart_value")
                .arg(cart_value_delta);
        }
        if is_rage_click {
            pipe.cmd("HINCRBY")
                .arg(&session_key)
                .arg("rage_click_count")
                .arg(1);
        }
        pipe.cmd("HSET")
            .arg(&session_key)
            .arg("last_activity")
            .arg(now_ms)
            .expire(&session_key, self.ttl_seconds as i64)
            .zadd("active:sessions", now_ms, session_id);
        
        if is_rage_click {
            pipe.lpush(&rage_ts_key, now_ms)
                .ltrim(&rage_ts_key, 0isize, (MAX_RAGE_TIMESTAMPS - 1) as isize)
                .expire(&rage_ts_key, self.ttl_seconds as i64);
        }

        let _: () = pipe.query_async(&mut con).await
            .map_err(|e| SessionError::RedisError(e.to_string()))?;

        // Read back state
        let (hash_data, rage_timestamps): (std::collections::HashMap<String, String>, Vec<String>) = redis::pipe()
            .hgetall(&session_key)
            .lrange(&rage_ts_key, 0, -1)
            .query_async(&mut con).await
            .map_err(|e| SessionError::RedisError(e.to_string()))?;

        let cart_value = hash_data.get("cart_value").and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
        let rage_click_count = hash_data.get("rage_click_count").and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
        let last_activity = hash_data.get("last_activity").and_then(|v| v.parse::<i64>().ok()).unwrap_or(now_ms);

        let recent_rage_clicks = rage_timestamps.iter()
            .filter(|ts| now_ms - ts.parse::<i64>().unwrap_or(0) <= RAGE_WINDOW_MS)
            .count() as i32;
        let is_frustrated = recent_rage_clicks >= RAGE_THRESHOLD;

        // Persist is_frustrated
        let mut pipe = redis::pipe();
        pipe.cmd("HSET")
            .arg(&session_key)
            .arg("is_frustrated")
            .arg(if is_frustrated { "1" } else { "0" });
        let _: () = pipe.query_async(&mut con).await
            .map_err(|e| SessionError::RedisError(e.to_string()))?;

        Ok(SessionState {
            cart_value,
            rage_click_count,
            last_activity,
            is_frustrated,
        })
    }

    /// Write identity context to session hash.
    pub async fn set_context(&self, session_id: &str, ctx: SessionContext) -> Result<(), SessionError> {
        let mut con = self.redis.get_multiplexed_async_connection().await
            .map_err(|e| SessionError::RedisError(e.to_string()))?;

        let session_key = format!("session:{}", session_id);
        let anon = ctx.anon.as_deref().unwrap_or(ctx.distinct_id.as_str()).to_string();
        let uid = ctx.uid.as_deref().unwrap_or("").to_string();
        let _: () = redis::cmd("HSET")
            .arg(&session_key)
            .arg("store_id")
            .arg(ctx.store_id.to_string())
            .arg("customer_id")
            .arg(ctx.customer_id.map(|id| id.to_string()).unwrap_or_default())
            .arg("distinct_id")
            .arg(&ctx.distinct_id)
            .arg("anon")
            .arg(anon)
            .arg("uid")
            .arg(uid)
            .arg("email")
            .arg(ctx.email.unwrap_or_default())
            .arg("email_consent")
            .arg(if ctx.email_consent { "1" } else { "0" })
            .arg("sms_consent")
            .arg(if ctx.sms_consent { "1" } else { "0" })
            .query_async::<_, ()>(&mut con)
            .await
            .map_err(|e| SessionError::RedisError(e.to_string()))?;

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct SessionState {
    /// Stored in Redis for downstream consumers (decision-engine scheduler).
    #[allow(dead_code)]
    pub cart_value: f64,
    pub rage_click_count: i32,
    /// Stored in Redis for downstream consumers.
    #[allow(dead_code)]
    pub last_activity: i64,
    pub is_frustrated: bool,
}