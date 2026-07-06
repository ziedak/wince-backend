use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEvent {
    pub event_id: String,
    pub event_type: String,
    pub session_id: String,
    pub distinct_id: String,
    pub store_id: i32,
    pub timestamp: String,
    pub cart_value: Option<f64>,
    pub customer_email: Option<String>,
    pub properties: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomerData {
    pub id: i32,
    pub email: Option<String>,
    pub lifetime_value: f64,
    pub email_consent: bool,
    pub sms_consent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionState {
    pub cart_value: f64,
    pub rage_click_count: i32,
    pub last_activity: i64,
    pub is_frustrated: bool,
}

/// Computed feature vector attached to every enriched event.
/// Fields that cannot be computed emit `None` (XGBoost native missing-value handling).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeatureVector {
    pub rage_clicks_30s: i64,
    pub add_to_cart_60s: i64,
    pub exit_intent_5m: i64,
    pub seconds_since_last_event: Option<f64>,
    pub seconds_since_last_add: Option<f64>,
    pub ewma_events_per_minute: f64,
    pub ewma_scroll_velocity: f64,
    pub rage_after_add: bool,
    pub exit_after_checkout: bool,
    pub idle_after_high_cart: bool,
    pub unique_event_types: i64,
    pub interventions_shown_this_session: i64,
    pub seconds_since_last_intervention: Option<f64>,
    pub cart_item_count: Option<i64>,
    pub cart_avg_item_price: Option<f64>,
    pub cart_has_discount: Option<bool>,
    pub cart_distinct_categories: Option<i64>,
    pub checkout_step_reached: Option<i32>,
    pub unique_pages_visited: Option<i64>,
    pub feature_schema_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichedEvent {
    pub event_id: String,
    pub event_type: String,
    pub session_id: String,
    pub distinct_id: String,
    pub store_id: i32,
    pub timestamp: String,
    pub cart_value: Option<f64>,
    pub customer_email: Option<String>,
    pub properties: Option<Value>,

    pub customer_id: Option<i32>,
    pub lifetime_value: f64,
    pub email_consent: bool,
    pub sms_consent: bool,
    pub rage_click_count: i32,
    pub is_frustrated: bool,
    pub session_available: bool,
    pub server_timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<FeatureVector>,
}

#[derive(Debug, Clone)]
pub enum EnrichResult {
    Enriched(EnrichedEvent),
    Duplicate,
}