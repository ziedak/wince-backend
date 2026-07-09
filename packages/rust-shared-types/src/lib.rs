use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Strips the browser SDK's transport prefix from an event `t` name, returning
/// the canonical action used for classification/matching throughout
/// enrichment-session and decision-engine.
///
/// The tracker-js SDK emits names like `$exit_intent`, `$user_idle`,
/// `$rage_click`, and `$cart_{action}` (e.g. `$cart_add`, `$cart_checkout_abandon`)
/// — see wince/packages/web/src/plugins/*.ts for the authoritative list.
/// Backend/webhook-originated events (e.g. `purchase`, `order_created`) are
/// already bare and pass through unchanged.
///
/// MUST be used instead of comparing `t`/raw `t` directly — every prior direct
/// comparison against bare strings (`"exit_intent"`, `"rage_click"`,
/// `"add_to_cart"`, `"checkout_step"`, `"idle_timeout"`, ...) silently never
/// matched in production because the real values carry the `$`/`$cart_` prefix.
pub fn canonical_event_type(t: &str) -> &str {
    if let Some(rest) = t.strip_prefix("$cart_") {
        return rest;
    }
    if let Some(rest) = t.strip_prefix('$') {
        return rest;
    }
    t
}

/// Canonical event shape consumed from the `raw.events` Kafka topic, matching
/// apps/ingestion's `ServerEvent` wire format field-for-field (only the subset
/// of fields actually used downstream is carried here — unknown JSON fields
/// are ignored by serde by default).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEvent {
    pub eid: String,
    pub t: String,
    pub sid: String,
    pub anon: String,
    #[serde(default)]
    pub uid: Option<String>,
    pub store_id: i32,
    pub ts: i64,
    #[serde(default)]
    pub props: Option<Value>,
    /// Delivery priority hint forwarded unchanged from ingestion (`_priority`).
    #[serde(default)]
    pub priority: Option<String>,
    /// Tracker-js contract version this event was produced under (`None` for
    /// pre-versioning SDKs, treated as `1`). Forwarded unchanged from
    /// ingestion's `ServerEvent.schema_v` so downstream consumers can branch
    /// on it if the contract changes in the future.
    #[serde(default)]
    pub schema_v: Option<u32>,
}

impl RawEvent {
    /// Best-effort cart value extraction from `props`. Checks the common keys
    /// used by the cart plugin / tracker-backend (`cart_value_total`, falling
    /// back to `revenue`). Ingestion does not promote this to a top-level
    /// field, so it must be derived here at read time.
    pub fn cart_value(&self) -> Option<f64> {
        let props = self.props.as_ref()?;
        props
            .get("cart_value_total")
            .or_else(|| props.get("revenue"))
            .and_then(|v| v.as_f64())
    }

    /// Best-effort customer email extraction from `props`.
    pub fn customer_email(&self) -> Option<String> {
        self.props
            .as_ref()?
            .get("email")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }
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
    // ── Rolling aggregates (ZCOUNT on per-type sorted sets) ─────────────────
    pub rage_clicks_30s: i64,
    pub add_to_cart_60s: i64,
    pub exit_intent_5m: i64,
    // ── Recency (None = no prior event in this session) ──────────────────────
    pub seconds_since_last_event: Option<f64>,
    pub seconds_since_last_add: Option<f64>,
    /// Seconds since the user last entered the checkout funnel (`checkout_start` event).
    pub seconds_since_last_checkout: Option<f64>,
    // ── EWMA velocity (exponentially smoothed, α configurable) ───────────────
    pub ewma_events_per_minute: f64,
    pub ewma_scroll_velocity: f64,
    /// Raw 30-second scroll velocity reported by the frontend on this event.
    pub scroll_velocity_30s: f64,
    // ── Pattern detection (Rust-side boolean logic) ───────────────────────────
    pub pattern_rage_after_add: bool,
    pub pattern_exit_after_checkout: bool,
    pub idle_after_high_cart: bool,
    // ── Cart dynamics ─────────────────────────────────────────────────────────
    /// Net cart value delta (add − remove) over the last 2 minutes.
    pub cart_value_delta_2m: f64,
    // ── Funnel progress ───────────────────────────────────────────────────────
    /// Highest `checkout_step` event reached this session (None = no checkout step yet).
    pub checkout_progress_max: Option<i32>,
    // ── Session duration ──────────────────────────────────────────────────────
    /// Total time on site in seconds (now − first event timestamp).
    pub time_on_site_total: i64,
    // ── Behavioural entropy ───────────────────────────────────────────────────
    pub unique_event_types: i64,
    // ── Intervention history (written by Decision Engine) ─────────────────────
    pub interventions_shown_this_session: i64,
    pub seconds_since_last_intervention: Option<f64>,
    // ── Cart composition (payload-derived; None until cart-items schema added) ─
    pub cart_item_count: Option<i64>,
    pub cart_avg_item_price: Option<f64>,
    pub cart_has_discount: Option<bool>,
    pub cart_distinct_categories: Option<i64>,
    // ── Funnel context (payload-derived; None until step schema added) ─────────
    pub checkout_step_reached: Option<i32>,
    pub unique_pages_visited: Option<i64>,
    // ── Schema versioning ─────────────────────────────────────────────────────
    pub feature_schema_version: String,
}

/// A RawEvent after enrichment — written to the `enriched.events` Kafka
/// topic. Field names are canonical (match packages/types's `EnrichedEvent`)
/// so decision-engine's Kafka-path and the HTTP trigger fast-path both
/// consume the same shape without translation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichedEvent {
    pub eid: String,
    pub t: String,
    pub sid: String,
    pub anon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    pub store_id: i32,
    pub ts: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub props: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    /// Tracker-js contract version this event was produced under — carried
    /// through unchanged from `RawEvent.schema_v`. See ingestion's
    /// `MIN_SUPPORTED_SCHEMA_V`/`MAX_SUPPORTED_SCHEMA_V` for the enforcement
    /// boundary; this field is informational for downstream consumers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_v: Option<u32>,

    pub customer_id: Option<i32>,
    pub cart_value: f64,
    pub lifetime_value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub email_consent: bool,
    pub sms_consent: bool,
    pub rage_click_count: i32,
    pub is_frustrated: bool,
    pub session_available: bool,
    /// Enrichment-session's own processing timestamp (distinct from ingestion's
    /// `ts`/`adjusted_ts`) — used for enrichment-latency freshness tracking.
    pub server_timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<FeatureVector>,
}

#[derive(Debug, Clone)]
pub enum EnrichResult {
    Enriched(EnrichedEvent),
    Duplicate,
}