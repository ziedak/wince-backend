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

    #[error("kafka error: {0}")]
    KafkaError(String),

    #[error("redis error: {0}")]
    RedisError(String),

    #[error("internal error: {0}")]
    InternalError(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Internal details of Kafka / Redis / InternalError are never
        // sent to the client — only a generic message is returned.
        // This prevents leaking infrastructure details to external callers.
        let (status, message) = match &self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
            AppError::KafkaError(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "event pipeline unavailable".to_string(),
            ),
            AppError::RedisError(_) => (
                // Redis failure is non-fatal in pipeline.rs (dedup is skipped),
                // but if we reach here it means the connection itself failed.
                StatusCode::SERVICE_UNAVAILABLE,
                "cache unavailable".to_string(),
            ),
            AppError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal server error".to_string(),
            ),
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
