use chrono::Utc;
use redis::aio::ConnectionLike;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tracing::{debug, warn};

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::kafka::{produce, AppProducer};

// ─── Wire format from browser SDK ────────────────────────────────────────────
// Reference: docs/domains/tracking-model.md

#[derive(Debug, Deserialize)]
pub struct TrackingEnvelope {
    /// Client-side timestamp when the batch was sent (ms since epoch)
    pub sent_at: i64,
    pub events: Vec<RawEvent>,
}

#[derive(Debug, Deserialize)]
pub struct RawEvent {
    /// UUID v7 event ID — primary dedupe key
    pub eid: String,
    /// Per-session monotonic sequence number
    pub seq: u64,
    /// Event name, e.g. '$page_view'
    pub t: String,
    /// Client capture timestamp (ms since epoch)
    pub ts: i64,
    /// Session ID
    pub sid: String,
    /// Anonymous device ID
    pub anon: String,
    /// Identified user ID (optional)
    pub uid: Option<String>,
    /// Event-specific properties
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

// ─── Server-enriched event (written to raw.events) ───────────────────────────

#[derive(Debug, Serialize)]
pub struct ServerEvent {
    pub eid: String,
    pub seq: u64,
    pub t: String,
    pub ts: i64,
    /// Clock-skew corrected: ts + (server_received_at - sent_at)
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
    /// Store resolved from API key via Kong X-Store-ID header
    pub store_id: u32,
    /// 'browser' or 'backend'
    pub source: String,
    /// Server receive timestamp (ms since epoch)
    pub server_received_at: i64,
    /// Client IP address
    pub ip: String,
}

/// Validates required fields on a raw event.
/// Returns an Err if any required field is missing or structurally invalid.
fn validate(event: &RawEvent) -> Result<(), AppError> {
    if event.eid.is_empty() {
        return Err(AppError::BadRequest("missing required field: eid".into()));
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
    // ts must be a positive Unix ms timestamp (> year 2000).
    if event.ts < 946_684_800_000 {
        return Err(AppError::BadRequest("field ts is not a valid Unix ms timestamp".into()));
    }
    Ok(())
}

/// Checks the Bloom filter for duplicate `eid`.
/// Returns true if this event was already seen (should be dropped).
///
/// BF.EXISTS + BF.ADD are issued as a pipeline (single round-trip).
/// This is safe because BF.ADD is idempotent on already-set items and
/// the worst outcome of a race is a false-positive drop, which is
/// acceptable for event ingestion.
async fn is_duplicate<C>(
    redis: &mut C,
    bloom_key: &str,
    eid: &str,
) -> Result<bool, AppError>
where
    C: ConnectionLike,
{
    // Pipeline both commands into one round-trip.
    let (exists, _added): (i64, i64) = redis::pipe()
        .cmd("BF.EXISTS").arg(bloom_key).arg(eid)
        .cmd("BF.ADD").arg(bloom_key).arg(eid)
        .query_async(redis)
        .await?;

    // exists == 1 means the item was already present before this request.
    Ok(exists == 1)
}

/// Core pipeline: unwrap the envelope, dedup, enrich, and produce to Kafka.
///
/// Returns the number of events successfully produced.
/// Generic over C so we accept any redis async connection type.
pub async fn process_envelope<C>(
    envelope: TrackingEnvelope,
    store_id: u32,
    source: String,
    ip: String,
    config: &AppConfig,
    producer: &AppProducer,
    redis: &mut C,
) -> Result<usize, AppError>
where
    C: ConnectionLike,
{
    let server_received_at = Utc::now().timestamp_millis();
    // Clamp skew to ±30 minutes to ignore pathological clock drift.
    // Without this, a malicious or buggy client with sent_at=0 would
    // produce adjusted_ts values decades in the future.
    let raw_skew = server_received_at - envelope.sent_at;
    let skew = raw_skew.clamp(-1_800_000, 1_800_000);

    let mut accepted = 0usize;

    for event in envelope.events {
        // 1. Validate required fields
        if let Err(e) = validate(&event) {
            warn!(eid = %event.eid, error = %e, "Dropping invalid event");
            continue;
        }

        // 2. Bloom filter deduplication
        match is_duplicate(redis, &config.redis_bloom_key, &event.eid).await {
            Ok(true) => {
                debug!(eid = %event.eid, "Dropping duplicate event");
                continue;
            }
            Ok(false) => {}
            Err(e) => {
                // Redis failure is non-fatal — log and continue without dedup
                // to avoid losing events when Redis is briefly unavailable.
                warn!(eid = %event.eid, error = %e, "Redis dedup check failed, proceeding without dedup");
            }
        }

        // 3. Clock-skew correction
        let adjusted_ts = event.ts + skew;

        // 4. Build server-enriched event
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

        // 5. Serialize and produce
        // Capture sid before server_event is moved into serde_json::to_string.
        let partition_key = server_event.sid.clone();
        let payload = serde_json::to_string(&server_event)
            .map_err(|e| AppError::InternalError(format!("serialization failed: {e}")))?;

        produce(producer, &config.kafka_topic_raw, &partition_key, &payload).await?;
        accepted += 1;
    }

    Ok(accepted)
}

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

    #[test]
    fn validate_accepts_valid_event() {
        let event = make_valid_event("eid-1");
        assert!(validate(&event).is_ok());
    }

    #[test]
    fn validate_rejects_missing_eid() {
        let event = make_valid_event("");
        assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn validate_rejects_missing_sid() {
        let mut event = make_valid_event("eid-1");
        event.sid = String::new();
        assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
    }

    #[test]
    fn validate_rejects_missing_event_name() {
        let mut event = make_valid_event("eid-1");
        event.t = String::new();
        assert!(matches!(validate(&event), Err(AppError::BadRequest(_))));
    }
}
