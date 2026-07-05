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
}

#[derive(Debug, Clone)]
pub enum EnrichResult {
    Enriched(EnrichedEvent),
    Duplicate,
}