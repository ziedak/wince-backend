use std::sync::Arc;
use std::collections::HashMap;
use thiserror::Error;
use rust_redis_client::RedisClient;

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
    redis: Arc<RedisClient>,
}

impl SessionService {
    pub fn new(redis: Arc<RedisClient>, _ttl_seconds: u64) -> Self {
        Self { redis }
    }

    /// Write identity context to session hash.
    pub async fn set_context(&self, session_id: &str, ctx: SessionContext) -> Result<(), SessionError> {
        let session_key = format!("session:{}", session_id);
        let anon = ctx.anon.as_deref().unwrap_or(&ctx.distinct_id).to_string();
        let uid = ctx.uid.as_deref().unwrap_or("").to_string();

        let fields: HashMap<String, String> = [
            ("store_id",      ctx.store_id.to_string()),
            ("customer_id",   ctx.customer_id.map(|id| id.to_string()).unwrap_or_default()),
            ("distinct_id",   ctx.distinct_id),
            ("anon",          anon),
            ("uid",           uid),
            ("email",         ctx.email.unwrap_or_default()),
            ("email_consent", if ctx.email_consent { "1" } else { "0" }.to_string()),
            ("sms_consent",   if ctx.sms_consent { "1" } else { "0" }.to_string()),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();

        self.redis.hset(&session_key, &fields).await
            .map_err(|e| SessionError::RedisError(e.to_string()))?;

        Ok(())
    }
}
