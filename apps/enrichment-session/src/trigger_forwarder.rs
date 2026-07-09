use std::sync::Arc;

use rust_shared_types::{canonical_event_type, EnrichedEvent};

const TRIGGER_EVENTS: [&str; 4] = ["checkout_abandon", "exit_intent", "rage_click", "add"];
const FORWARD_TIMEOUT_MS: u64 = 500;

pub struct TriggerForwarder {
    client: reqwest::Client,
    trigger_url: String,
    internal_secret: String,
}

impl TriggerForwarder {
    pub fn new(decision_engine_url: String, internal_secret: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(FORWARD_TIMEOUT_MS))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let trigger_url = decision_engine_url.trim_end_matches('/').to_string() + "/v1/trigger";
        Self { client, trigger_url, internal_secret }
    }

    /// Forward trigger events to decision-engine. Non-fatal, always resolves.
    pub async fn maybe_forward(&self, event: Arc<EnrichedEvent>) {
        if !TRIGGER_EVENTS.contains(&canonical_event_type(&event.t)) {
            return;
        }

        let body = match serde_json::to_string(event.as_ref()) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = %e, "Failed to serialize trigger event");
                return;
            }
        };

        let result = self.client
            .post(&self.trigger_url)
            .header("Content-Type", "application/json")
            .header("X-Internal-Secret", &self.internal_secret)
            .body(body)
            .send()
            .await;

        match result {
            Ok(resp) if !resp.status().is_success() && resp.status() != reqwest::StatusCode::ACCEPTED => {
                tracing::warn!(status = %resp.status(), session_id = %event.sid, "TriggerForwarder: non-202 response from decision-engine");
            }
            Ok(_) => {}
            Err(e) if e.is_timeout() => {
                tracing::warn!(session_id = %event.sid, timeout_ms = FORWARD_TIMEOUT_MS, "TriggerForwarder: request timed out");
            }
            Err(e) => {
                tracing::warn!(error = %e, session_id = %event.sid, "TriggerForwarder: forward failed (non-fatal)");
            }
        }
    }
}