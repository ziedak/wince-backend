use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde_json::json;
use std::sync::Arc;
use tracing::instrument;

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::pipeline::{process_envelope, TrackingEnvelope};
use crate::rate_limiter::{OverflowLimiter, StoreLimiter};
use crate::sinks::Sink;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    /// Active event sink — KafkaSink or FallbackSink(Kafka, S3).
    pub sink: Arc<dyn Sink>,
    /// Redis client — a new multiplexed connection is acquired per request.
    pub redis: Arc<redis::Client>,
    /// Per-store HTTP-layer rate limiter (Phase 3).
    pub store_limiter: Arc<StoreLimiter>,
    /// Per-(store, anon) overflow detector (Phase 5).
    pub overflow_limiter: Arc<OverflowLimiter>,
}

/// POST /v1/track
///
/// Expects:
///   X-Store-ID: <u32>   — injected by Kong from the validated API key consumer
///   X-Source: browser | backend  — defaults to 'browser'
///   X-Real-IP or X-Forwarded-For — client IP (set by Kong)
///   Body: TrackingEnvelope JSON
#[instrument(skip(state, headers, body), fields(store_id))]
pub async fn track_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TrackingEnvelope>,
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

    // 2. Rate limit check (Phase 3)
    if state.store_limiter.is_limited(store_id) {
        metrics::counter!("ingestion_rate_limited_total").increment(1);
        return Err(AppError::RateLimited);
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

    // 5. Acquire a Redis connection for this request
    let mut redis_conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(AppError::from)?;

    // 6. Delegate to pipeline
    let accepted = process_envelope(
        body,
        store_id,
        source,
        ip,
        &state.config,
        &state.sink,
        &state.overflow_limiter,
        &mut redis_conn,
    )
    .await?;

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "accepted": accepted })),
    ))
}
