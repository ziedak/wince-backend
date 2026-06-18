use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("event payload too large: {0}")]
    EventTooBig(String),

    #[error("rate limited")]
    RateLimited,

    #[error("kafka error: {0}")]
    KafkaError(String),

    #[error("redis error: {0}")]
    RedisError(String),

    #[error("internal error: {0}")]
    InternalError(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // RateLimited gets a Retry-After header — handled before the generic match.
        if let AppError::RateLimited = self {
            let mut resp = (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({ "error": "rate limited" })),
            )
                .into_response();
            resp.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                axum::http::HeaderValue::from_static("1"),
            );
            return resp;
        }

        // Internal details (Kafka / Redis / Internal) are never forwarded to
        // the client — only a generic message is returned to prevent info leaks.
        let (status, message) = match &self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
            AppError::EventTooBig(_) => (
                StatusCode::PAYLOAD_TOO_LARGE,
                "event payload too large".to_string(),
            ),
            AppError::KafkaError(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "event pipeline unavailable".to_string(),
            ),
            AppError::RedisError(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "cache unavailable".to_string(),
            ),
            AppError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal server error".to_string(),
            ),
            AppError::RateLimited => unreachable!("handled above"),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl From<rdkafka::error::KafkaError> for AppError {
    fn from(err: rdkafka::error::KafkaError) -> Self {
        AppError::KafkaError(err.to_string())
    }
}

impl From<redis::RedisError> for AppError {
    fn from(err: redis::RedisError) -> Self {
        AppError::RedisError(err.to_string())
    }
}
