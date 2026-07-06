use std::sync::Arc;
use thiserror::Error;

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
}

impl SessionService {
    pub fn new(redis: Arc<redis::Client>, _ttl_seconds: u64) -> Self {
        Self { redis }
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
