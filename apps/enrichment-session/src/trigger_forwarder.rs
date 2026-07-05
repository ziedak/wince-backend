use std::sync::Arc;

use rust_shared_types::EnrichedEvent;

const TRIGGER_EVENTS: [&str; 4] = ["checkout_abandon", "exit_intent", "rage_click", "add_to_cart"];
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
        if !TRIGGER_EVENTS.contains(&event.event_type.as_str()) {
            return;
        }

        let body = match serde_json::to_string(&self.to_canonical_event(&event)) {
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
                tracing::warn!(status = %resp.status(), session_id = %event.session_id, "TriggerForwarder: non-202 response from decision-engine");
            }
            Ok(_) => {}
            Err(e) if e.is_timeout() => {
                tracing::warn!(session_id = %event.session_id, timeout_ms = FORWARD_TIMEOUT_MS, "TriggerForwarder: request timed out");
            }
            Err(e) => {
                tracing::warn!(error = %e, session_id = %event.session_id, "TriggerForwarder: forward failed (non-fatal)");
            }
        }
    }

    /// Maps enrichment-session's local event shape to canonical field names.
    fn to_canonical_event(&self, e: &EnrichedEvent) -> serde_json::Value {
        let ts_ms = if e.timestamp.is_empty() { chrono::Utc::now().timestamp_millis() } else { chrono::DateTime::parse_from_rfc3339(&e.timestamp).map(|dt| dt.timestamp_millis()).unwrap_or(chrono::Utc::now().timestamp_millis()) };
        
        serde_json::json!({
            "eid": e.event_id,
            "seq": 0,
            "t": e.event_type,
            "ts": ts_ms,
            "sid": e.session_id,
            "anon": e.distinct_id,
            "props": e.properties,
            "store_id": e.store_id,
            "source": "backend",
            "server_received_at": chrono::Utc::now().timestamp_millis(),
            "adjusted_ts": ts_ms,
            "ip": "",
            "customer_id": e.customer_id,
            "cart_value": e.cart_value.unwrap_or(0.0),
            "rage_click_count": e.rage_click_count,
            "is_frustrated": e.is_frustrated,
            "lifetime_value": e.lifetime_value,
            "email": e.customer_email,
            "email_consent": e.email_consent,
            "sms_consent": e.sms_consent,
            "session_available": e.session_available,
        })
    }
}