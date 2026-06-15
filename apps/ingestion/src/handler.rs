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
use crate::kafka::AppProducer;
use crate::pipeline::{process_envelope, TrackingEnvelope};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub producer: Arc<AppProducer>,
    /// Redis client — a new multiplexed connection is acquired per request.
    pub redis: Arc<redis::Client>,
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
    // 1. Resolve store_id from Kong-injected header (Kong validated the API key)
    let store_id = headers
        .get("x-store-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or(AppError::Unauthorized)?;

    // 2. Event source (browser vs WooCommerce backend)
    let source = headers
        .get("x-source")
        .and_then(|v| v.to_str().ok())
        .map(|s| match s {
            "backend" => "backend",
            _ => "browser",
        })
        .unwrap_or("browser")
        .to_string();

    // 3. Client IP — Kong sets X-Real-IP or X-Forwarded-For
    let ip = headers
        .get("x-real-ip")
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or("").trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 4. Acquire a Redis connection for this request
    let mut redis_conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .map_err(AppError::from)?;

    // 5. Delegate to pipeline — zero business logic in this handler
    let accepted = process_envelope(
        body,
        store_id,
        source,
        ip,
        &state.config,
        &state.producer,
        &mut redis_conn,
    )
    .await?;

    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "accepted": accepted })),
    ))
}
