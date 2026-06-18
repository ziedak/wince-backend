use chrono::Utc;
use redis::aio::ConnectionLike;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, warn};

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::metrics::report_dropped_event;
use crate::rate_limiter::OverflowLimiter;
use crate::sinks::Sink;

// ─── Wire format from browser SDK ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TrackingEnvelope {
    pub sent_at: i64,
    pub events: Vec<RawEvent>,
}

#[derive(Debug, Deserialize)]
pub struct RawEvent {
    pub eid: String,
    pub seq: u64,
    pub t: String,
    pub ts: i64,
    pub sid: String,
    pub anon: String,
    pub uid: Option<String>,
    #[serde(default)]
    pub props: HashMap<String, Value>,
    #[serde(rename = "$set")]
    pub set: Option<HashMap<String, Value>>,
    #[serde(rename = "$set_once")]
    pub set_once: Option<HashMap<String, Value>>,
    pub url: Option<String>,
    #[serde(rename = "ref")]
    pub referrer: Option<String>,
    pub window_id: Option<String>,
    pub pageview_id: Option<String>,
    pub offset: Option<i64>,
    pub schema_v: Option<u32>,
}

// ─── Server-enriched event ───────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ServerEvent {
    pub eid: String,
    pub seq: u64,
    pub t: String,
    pub ts: i64,
    pub adjusted_ts: i64,
    pub sid: String,
    pub anon: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub props: HashMap<String, Value>,
    #[serde(rename = "$set", skip_serializing_if = "Option::is_none")]
    pub set: Option<HashMap<String, Value>>,
    #[serde(rename = "$set_once", skip_serializing_if = "Option::is_none")]
    pub set_once: Option<HashMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub referrer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pageview_id: Option<String>,
    pub offset: Option<i64>,
    pub schema_v: Option<u32>,
    pub store_id: u32,
    pub source: String,
    pub server_received_at: i64,
    pub ip: String,
}

// ─── Event classification (Phase 4) ─────────────────────────────────────────

enum DataType {
    Analytics,
    Error,
    Identify,
    Checkout,
}

fn classify(event_name: &str) -> DataType {
    match event_name {
        "$exception" => DataType::Error,
        "$identify" | "$alias" | "$create_alias" => DataType::Identify,
        name if name.starts_with("$checkout_")
            || name.starts_with("order_")
            || name == "purchase"
            || name == "checkout_started" =>
        {
            DataType::Checkout
        }
        _ => DataType::Analytics,
    }
}

fn topic_for<'a>(dt: &DataType, config: &'a AppConfig) -> &'a str {
    match dt {
        DataType::Error => &config.kafka_topic_error,
        DataType::Identify => &config.kafka_topic_identify,
        DataType::Checkout => &config.kafka_topic_checkout,
        DataType::Analytics => &config.kafka_topic_raw,
    }
}

// ─── Validation (Phase 2) ────────────────────────────────────────────────────

fn validate(event: &RawEvent) -> Result<(), AppError> {
    if event.eid.is_empty() {
        return Err(AppError::BadRequest("missing required field: eid".into()));
    }
    // Phase 2: eid must be a parseable UUID to keep the Bloom filter reliable.
    if uuid::Uuid::parse_str(&event.eid).is_err() {
        return Err(AppError::BadRequest(format!(
            "eid is not a valid UUID: {}",
            event.eid
        )));
    }
    if event.t.is_empty() {
        return Err(AppError::BadRequest("missing required field: t".into()));
    }
    if event.sid.is_empty() {
        return Err(AppError::BadRequest("missing required field: sid".into()));
    }
    if event.anon.is_empty() {
        return Err(AppError::BadRequest("missing required field: anon".into()));
    }
    // Guard against impossible clock values that would corrupt adjusted_ts.
    if event.ts < 946_684_800_000 {
        return Err(AppError::BadRequest(
            "field ts is not a valid Unix ms timestamp".into(),
        ));
    }
    Ok(())
}

// ─── Bloom filter deduplication ──────────────────────────────────────────────

async fn is_duplicate<C>(redis: &mut C, bloom_key: &str, eid: &str) -> Result<bool, AppError>
where
    C: ConnectionLike,
{
    let (exists, _added): (i64, i64) = redis::pipe()
        .cmd("BF.EXISTS")
        .arg(bloom_key)
        .arg(eid)
        .cmd("BF.ADD")
        .arg(bloom_key)
        .arg(eid)
        .query_async(redis)
        .await?;
    Ok(exists == 1)
}

// ─── DLQ helper (Phase 7) ────────────────────────────────────────────────────

async fn send_to_dlq(sink: &dyn Sink, dlq_topic: &str, eid: &str, event_name: &str, error: &str, store_id: u32) {
    let msg = serde_json::json!({
        "eid": eid,
        "t": event_name,
        "store_id": store_id,
        "error": error,
    });
    if let Err(e) = sink.send(dlq_topic, eid, &msg.to_string()).await {
        warn!(eid, error = %e, "Failed to send invalid event to DLQ");
    }
}

// ─── Core pipeline ───────────────────────────────────────────────────────────

pub async fn process_envelope<C>(
    envelope: TrackingEnvelope,
    store_id: u32,
    source: String,
    ip: String,
    config: &AppConfig,
    sink: &Arc<dyn Sink>,
    overflow_limiter: &OverflowLimiter,
    redis: &mut C,
) -> Result<usize, AppError>
where
    C: ConnectionLike,
{
    let server_received_at = Utc::now().timestamp_millis();

    // Phase 1 — batch size metric
    metrics::histogram!("ingestion_batch_size").record(envelope.events.len() as f64);

    // Clamp skew to ±30 min to ignore pathological clock drift.
    let raw_skew = server_received_at - envelope.sent_at;
    let skew = raw_skew.clamp(-1_800_000, 1_800_000);

    // Phase 1 — clock skew metric
    metrics::histogram!("ingestion_clock_skew_seconds")
        .record((raw_skew.unsigned_abs() as f64) / 1_000.0);

    let mut accepted = 0usize;

    for event in envelope.events {
        // ── Step 1: Validate (Phase 2) ────────────────────────────────────
        if let Err(ref e) = validate(&event) {
            warn!(eid = %event.eid, error = %e, "Dropping invalid event");
            report_dropped_event("invalid");
            send_to_dlq(sink.as_ref(), &config.kafka_topic_dlq, &event.eid, &event.t, &e.to_string(), store_id).await;
            continue;
        }

        // ── Step 2: Bloom filter deduplication ───────────────────────────
        match is_duplicate(redis, &config.redis_bloom_key, &event.eid).await {
            Ok(true) => {
                debug!(eid = %event.eid, "Dropping duplicate event");
                report_dropped_event("duplicate");
                continue;
            }
            Ok(false) => {}
            Err(e) => {
                warn!(eid = %event.eid, error = %e, "Redis dedup check failed, proceeding without dedup");
            }
        }

        // ── Step 3: Clock-skew correction ────────────────────────────────
        let adjusted_ts = event.ts + skew;

        // ── Step 4: Build enriched server event ───────────────────────────
        let server_event = ServerEvent {
            eid: event.eid,
            seq: event.seq,
            t: event.t,
            ts: event.ts,
            adjusted_ts,
            sid: event.sid.clone(),
            anon: event.anon,
            uid: event.uid,
            props: event.props,
            set: event.set,
            set_once: event.set_once,
            url: event.url,
            referrer: event.referrer,
            window_id: event.window_id,
            pageview_id: event.pageview_id,
            offset: event.offset,
            schema_v: event.schema_v,
            store_id,
            source: source.clone(),
            server_received_at,
            ip: ip.clone(),
        };

        // ── Step 5: Serialize ─────────────────────────────────────────────
        let payload = serde_json::to_string(&server_event)
            .map_err(|e| AppError::InternalError(format!("serialization failed: {e}")))?;

        // ── Step 6: Size check (Phase 2) ──────────────────────────────────
        if payload.len() > config.max_event_bytes {
            warn!(
                eid = %server_event.eid,
                bytes = payload.len(),
                max = config.max_event_bytes,
                "Dropping oversized event"
            );
            report_dropped_event("too_big");
            let dlq_msg = serde_json::json!({
                "eid": server_event.eid,
                "t": server_event.t,
                "store_id": server_event.store_id,
                "error": format!("event payload too large: {} bytes (max {})", payload.len(), config.max_event_bytes),
            });
            let _ = sink.send(&config.kafka_topic_dlq, &server_event.sid, &dlq_msg.to_string()).await;
            continue;
        }

        // ── Step 7: Historical rerouting (Phase 9) ────────────────────────
        let age_ms = server_received_at - server_event.adjusted_ts;
        let is_historical = config.historical_rerouting_enabled
            && age_ms > config.historical_threshold_ms();

        // ── Step 8: Overflow routing (Phase 5) ────────────────────────────
        let is_overflow =
            !is_historical && overflow_limiter.is_hot_key(store_id, &server_event.anon);

        // ── Step 9: Topic + partition key selection ───────────────────────
        let (topic, partition_key): (&str, String) = if is_historical {
            (&config.kafka_topic_historical, server_event.sid.clone())
        } else if is_overflow {
            metrics::counter!("ingestion_overflow_rerouted_total").increment(1);
            // Empty partition key → Kafka round-robins across all partitions.
            (&config.kafka_topic_overflow, String::new())
        } else {
            let dt = classify(&server_event.t);
            (topic_for(&dt, config), server_event.sid.clone())
        };

        // ── Step 10: Produce (Phase 1 metrics) ────────────────────────────
        let start = std::time::Instant::now();
        if let Err(e) = sink.send(topic, &partition_key, &payload).await {
            report_dropped_event("kafka_error");
            return Err(e);
        }
        metrics::histogram!("ingestion_produce_duration_seconds")
            .record(start.elapsed().as_secs_f64());
        metrics::histogram!("ingestion_event_payload_bytes").record(payload.len() as f64);
        metrics::counter!("ingestion_events_accepted_total").increment(1);
        accepted += 1;
    }

    Ok(accepted)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_event(eid: &str) -> RawEvent {
        RawEvent {
            eid: eid.to_string(),
            seq: 1,
            t: "$page_view".to_string(),
            ts: 1700000000000,
            sid: "sid-1".to_string(),
            anon: "anon-1".to_string(),
            uid: None,
            props: HashMap::new(),
            set: None,
            set_once: None,
            url: None,
            referrer: None,
            window_id: None,
            pageview_id: None,
            offset: None,

            schema_v: Some(1),
        }
    }

    // A valid UUIDv7 for use in tests.
    const VALID_EID: &str = "01906b67-0000-7000-8000-000000000001";

    #[test]
    fn validate_accepts_valid_event() {
        let event = make_valid_event(VALID_EID);
        assert!(validate(&event).is_ok());
    }

    #[test]
    fn validate_rejects_missing_eid() {
        let event = make_valid_event("");
        assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn validate_rejects_non_uuid_eid() {
        let event = make_valid_event("not-a-uuid");
        assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn validate_rejects_missing_sid() {
        let mut event = make_valid_event(VALID_EID);
        event.sid = String::new();
        assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn validate_rejects_missing_event_name() {
        let mut event = make_valid_event(VALID_EID);
        event.t = String::new();
        assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn classify_routes_exception_to_error() {
        assert!(matches!(classify("$exception"), DataType::Error));
    }

    #[test]
    fn classify_routes_identify() {
        assert!(matches!(classify("$identify"), DataType::Identify));
        assert!(matches!(classify("$alias"), DataType::Identify));
    }

    #[test]
    fn classify_routes_checkout() {
        assert!(matches!(classify("order_completed"), DataType::Checkout));
        assert!(matches!(classify("$checkout_started"), DataType::Checkout));
        assert!(matches!(classify("purchase"), DataType::Checkout));
    }

    #[test]
    fn classify_routes_analytics_by_default() {
        assert!(matches!(classify("$page_view"), DataType::Analytics));
        assert!(matches!(classify("custom_event"), DataType::Analytics));
    }
}
