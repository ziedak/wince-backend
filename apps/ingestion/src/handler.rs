use axum::{
    extract::{Request, State},
    http::HeaderMap,
    response::IntoResponse,
};
use std::sync::Arc;
use tracing::instrument;

use crate::config::AppConfig;
use crate::decompression::decompress;
use crate::errors::AppError;
use crate::pipeline::{process_envelope, TrackingEnvelope};
use crate::quota_limiter::QuotaLimiter;
use crate::rate_limiter::{DistributedStoreLimiter, OverflowLimiter, StoreLimiter};
use crate::restrictions::RestrictionStore;
use crate::response::BatchResult;
use crate::sinks::Sink;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    /// Active event sink — KafkaSink or FallbackSink(Kafka, S3).
    pub sink: Arc<dyn Sink>,
    /// Redis client — a new multiplexed connection is acquired per request.
    pub redis: Arc<redis::Client>,
    /// Per-store HTTP-layer rate limiter (in-process).
    pub store_limiter: Arc<StoreLimiter>,
    /// Per-(store, anon) overflow detector (in-process).
    pub overflow_limiter: Arc<OverflowLimiter>,
    /// Optional cross-replica Redis rate limiter (runs after in-process gate).
    pub dist_limiter: Option<Arc<DistributedStoreLimiter>>,
    /// Per-store quota limiter (in-memory cache refreshed from Redis).
    pub quota_limiter: Arc<QuotaLimiter>,
    /// Per-store event restriction filter (in-memory cache refreshed from Redis).
    pub restriction_store: Arc<RestrictionStore>,
}

/// POST /v1/track
///
/// Expects:
///   X-Store-ID: <u32>          — injected by Kong from the validated API key consumer
///   X-Source: browser|backend  — defaults to 'browser'
///   X-Real-IP or X-Forwarded-For — client IP (set by Kong)
///   Content-Encoding: gzip|deflate|br|zstd — optional body compression
///   Body: TrackingEnvelope JSON (optionally compressed)
///
/// Returns 202 with a per-event outcome map:
///   { "results": { "<eid>": { "result": "ok|drop|warning|retry" } } }
#[instrument(skip(state, headers, request), fields(store_id))]
pub async fn track_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
) -> Result<impl IntoResponse, AppError> {
    // 1. Resolve store_id from Kong-injected header
    let store_id = match headers.get("x-store-id") {
        None => {
            metrics::counter!("ingestion_auth_failures_total", "reason" => "missing_header")
                .increment(1);
            return Err(AppError::Unauthorized);
        }
        Some(v) => match v.to_str().ok().and_then(|s| s.parse::<u32>().ok()) {
            Some(id) => id,
            None => {
                metrics::counter!("ingestion_auth_failures_total", "reason" => "malformed_header")
                    .increment(1);
                return Err(AppError::Unauthorized);
            }
        },
    };

    tracing::Span::current().record("store_id", store_id);

    // 2. Rate limit check (in-process gate first for speed, then distributed)
    if state.store_limiter.is_limited(store_id) {
        metrics::counter!("ingestion_rate_limited_total").increment(1);
        return Err(AppError::RateLimited);
    }
    if let Some(dist) = &state.dist_limiter {
        if dist.is_limited(store_id).await {
            metrics::counter!("ingestion_rate_limited_total").increment(1);
            return Err(AppError::RateLimited);
        }
    }

    // 3. Event source (browser vs WooCommerce backend)
    let source = headers
        .get("x-source")
        .and_then(|v| v.to_str().ok())
        .map(|s| match s {
            "backend" => "backend",
            _ => "browser",
        })
        .unwrap_or("browser")
        .to_string();

    // 4. Client IP — Kong sets X-Real-IP or X-Forwarded-For
    let ip = headers
        .get("x-real-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("").trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 5. Read body with optional per-chunk timeout, then decompress
    let content_encoding = headers
        .get(axum::http::header::CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok());
    let chunk_timeout = state
        .config
        .body_chunk_timeout_ms
        .map(std::time::Duration::from_millis);
    let raw_body = crate::body::read_body(
        request.into_body(),
        state.config.max_request_body_bytes,
        chunk_timeout,
    )
    .await?;
    let raw_bytes = decompress(raw_body, content_encoding)?;
    metrics::histogram!("ingestion_request_body_bytes").record(raw_bytes.len() as f64);

    // 6. Parse JSON envelope
    let envelope: TrackingEnvelope = serde_json::from_slice(&raw_bytes)
        .map_err(|e| AppError::BadRequest(format!("invalid JSON: {e}")))?;

    // 7. Acquire a Redis connection for this request
    let mut redis_conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(AppError::from)?;

    // 8. Delegate to pipeline — returns per-event outcome map
    let result: BatchResult = process_envelope(
        envelope,
        store_id,
        source,
        ip,
        &state.config,
        &state.sink,
        &state.overflow_limiter,
        &state.quota_limiter,
        &state.restriction_store,
        &mut redis_conn,
    )
    .await?;

    Ok(result)
}
