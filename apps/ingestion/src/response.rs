//! Per-event batch response types.
//!
//! The `/v1/track` endpoint returns a per-UUID outcome map so SDKs can
//! distinguish events that were accepted from those that were dropped,
//! need a retry, or were accepted with reduced processing (warning).

use axum::http::{HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Serialize;
use std::collections::BTreeMap;

/// Per-event outcome returned in the HTTP response.
///
/// - `Ok` — accepted and persisted to Kafka.
/// - `Drop` — rejected permanently; do not resubmit.
///   Reasons: validation failure, duplicate, oversized, quota exceeded.
/// - `Warning` — accepted with reduced processing (e.g. illegal anon_id that
///   would cause person-merge pollution). Do not resubmit.
/// - `Retry` — not persisted (e.g. Kafka unavailable). Safe to resubmit;
///   a `Retry-After: 1` response header is added when any event has this outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventOutcome {
    Ok,
    Drop,
    Warning,
    Retry,
}

/// Status of a single event in the response body.
#[derive(Debug, Serialize)]
pub struct EventStatus {
    pub result: EventOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<&'static str>,
}

/// Aggregated result of processing one `TrackingEnvelope`.
/// Returned by `process_envelope` and converted into the HTTP response body.
#[derive(Debug, Default)]
pub struct BatchResult {
    /// Per-event outcomes in processing order.
    pub entries: Vec<(String, EventStatus)>,
    /// True when at least one event has `result: retry`.
    /// Causes a `Retry-After: 1` header to be included in the response.
    pub has_retry: bool,
}

impl BatchResult {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an outcome for one event.
    pub fn push(&mut self, eid: String, outcome: EventOutcome, details: Option<&'static str>) {
        if outcome == EventOutcome::Retry {
            self.has_retry = true;
        }
        self.entries.push((eid, EventStatus { result: outcome, details }));
    }
}

impl IntoResponse for BatchResult {
    fn into_response(self) -> axum::response::Response {
        // Serialize as { "results": { "<eid>": { "result": "ok" }, ... } }
        let map: BTreeMap<String, EventStatus> = self.entries.into_iter().collect();
        let body = serde_json::json!({ "results": map });
        let mut resp = (StatusCode::ACCEPTED, Json(body)).into_response();
        if self.has_retry {
            resp.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                HeaderValue::from_static("1"),
            );
        }
        resp
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::response::IntoResponse;
    use serde_json::Value;

    #[tokio::test]
    async fn empty_batch_produces_empty_results_map() {
        let batch = BatchResult::new();
        let resp = batch.into_response();
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        assert!(resp.headers().get(axum::http::header::RETRY_AFTER).is_none());
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["results"], serde_json::json!({}));
    }

    #[tokio::test]
    async fn retry_outcome_sets_retry_after_header() {
        let mut batch = BatchResult::new();
        batch.push("eid-1".to_string(), EventOutcome::Retry, Some("not_persisted"));
        let resp = batch.into_response();
        assert_eq!(
            resp.headers().get(axum::http::header::RETRY_AFTER).unwrap(),
            "1"
        );
    }

    #[tokio::test]
    async fn ok_outcome_omits_retry_after_header() {
        let mut batch = BatchResult::new();
        batch.push("eid-1".to_string(), EventOutcome::Ok, None);
        let resp = batch.into_response();
        assert!(resp.headers().get(axum::http::header::RETRY_AFTER).is_none());
    }

    #[tokio::test]
    async fn mixed_outcomes_serialize_correctly() {
        let mut batch = BatchResult::new();
        batch.push("aaa".to_string(), EventOutcome::Ok, None);
        batch.push("bbb".to_string(), EventOutcome::Drop, Some("duplicate"));
        batch.push("ccc".to_string(), EventOutcome::Warning, Some("illegal_id"));
        let resp = batch.into_response();
        let body = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["results"]["aaa"]["result"], "ok");
        assert!(json["results"]["aaa"]["details"].is_null());
        assert_eq!(json["results"]["bbb"]["result"], "drop");
        assert_eq!(json["results"]["bbb"]["details"], "duplicate");
        assert_eq!(json["results"]["ccc"]["result"], "warning");
        assert_eq!(json["results"]["ccc"]["details"], "illegal_id");
    }

    #[tokio::test]
    async fn drop_outcome_does_not_set_retry_after() {
        let mut batch = BatchResult::new();
        batch.push("x".to_string(), EventOutcome::Drop, Some("too_big"));
        let resp = batch.into_response();
        assert!(resp.headers().get(axum::http::header::RETRY_AFTER).is_none());
    }

    #[tokio::test]
    async fn mixed_batch_with_retry_sets_header() {
        let mut batch = BatchResult::new();
        batch.push("ok-1".to_string(), EventOutcome::Ok, None);
        batch.push("retry-1".to_string(), EventOutcome::Retry, Some("not_persisted"));
        let resp = batch.into_response();
        assert!(resp.headers().get(axum::http::header::RETRY_AFTER).is_some());
    }
}
