use chrono::{DateTime, Duration, Utc};
use redis::aio::ConnectionLike;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tracing::{debug, warn};

use crate::config::AppConfig;
use crate::errors::AppError;
use crate::metrics::report_dropped_event;
use crate::quota_limiter::{QuotaBucket, QuotaLimiter};
use crate::rate_limiter::OverflowLimiter;
use crate::response::{BatchResult, EventOutcome};
use crate::restrictions::RestrictionStore;
use crate::sinks::{Sink, SinkHeaders};

// ─── Pipeline context (bundles all shared state for process_envelope) ─────────

/// All per-request context that `process_envelope` needs beyond the envelope
/// itself and the Redis connection. Eliminates the 5-arg tail of the function
/// signature that was growing with every feature.
pub struct PipelineContext<'a> {
    pub config: &'a AppConfig,
    pub sink: &'a Arc<dyn Sink>,
    pub overflow_limiter: &'a OverflowLimiter,
    pub quota_limiter: &'a QuotaLimiter,
    pub restriction_store: &'a RestrictionStore,
}

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
    /// Per-event SDK processing flags.
    #[serde(default)]
    pub options: EventOptions,
}

/// Per-event processing flags sent by the client SDK.
#[derive(Debug, Deserialize, Default, Clone, Copy)]
pub struct EventOptions {
    /// Skip server-side clock-skew correction for this event.
    /// Useful for deliberately back-dated events from the SDK.
    #[serde(default)]
    pub disable_skew_correction: bool,
    /// Event captured in cookieless mode; downstream consumers should avoid
    /// cross-session identity resolution.
    #[serde(default)]
    pub cookieless_mode: bool,
    /// Explicit SDK request to create/update a person profile for this event.
    /// When `false` (default) the pipeline defers to organisation-level settings.
    #[serde(default)]
    pub process_person_profile: bool,
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
    pub cookieless_mode: bool,
    pub process_person_profile: bool,
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

// ─── Illegal distinct-ID list ───────────────────────────────────────────────
//
// JavaScript SDKs sometimes send well-known placeholder strings instead of real
// IDs.  We accept these events (so the funnel remains intact) but disable person
// processing to prevent poisoning the identity graph.
const ILLEGAL_IDS: &[&str] = &[
    "0",
    "00000000-0000-0000-0000-000000000000",
    "[object object]",
    "[object Object]",
    "anonymous",
    "anonymous-user",
    "distinct_id",
    "email",
    "false",
    "guest",
    "nan",
    "none",
    "not authenticated",
    "not-authenticated",
    "not_authenticated",
    "null",
    "system",
    "undefined",
    "unknown",
];

/// Returns `true` if `id` is a known SDK placeholder that must not be used for
/// identity resolution.  Comparison is case-insensitive and trims whitespace.
fn is_illegal_id(id: &str) -> bool {
    let id = id.trim().to_ascii_lowercase();
    ILLEGAL_IDS.iter().any(|illegal| id == *illegal)
}

// ─── Validation ───────────────────────────────────────────────────────────────

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
    // Field length limits — prevent identity graph pollution from over-long IDs.
    const MAX_LEN: usize = 200;
    if event.t.len() > MAX_LEN {
        return Err(AppError::BadRequest(
            format!("field t exceeds max length of {MAX_LEN}"),
        ));
    }
    if event.anon.len() > MAX_LEN {
        return Err(AppError::BadRequest(
            format!("field anon exceeds max length of {MAX_LEN}"),
        ));
    }
    if event.uid.as_deref().is_some_and(|u| u.len() > MAX_LEN) {
        return Err(AppError::BadRequest(
            format!("field uid exceeds max length of {MAX_LEN}"),
        ));
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

/// Bloom filter key TTL — 48 h in seconds.  Each daily window key is kept
/// alive for 48 h from its last write to ensure cross-midnight deduplication.
const BLOOM_KEY_TTL_SECS: u64 = 48 * 60 * 60; // 172 800

/// Return the today and yesterday window keys for the Bloom filter.
///
/// Keys are formatted as `{prefix}:{YYYYMMDD}` so each calendar day gets its
/// own Bloom filter.  Checking both windows catches duplicates submitted just
/// before and just after midnight.
fn bloom_window_keys(prefix: &str, now: DateTime<Utc>) -> (String, String) {
    let today = format!("{prefix}:{}", now.format("%Y%m%d"));
    let yesterday = format!(
        "{prefix}:{}",
        (now - Duration::days(1)).format("%Y%m%d")
    );
    (today, yesterday)
}

/// Batch-check `eids` against the Bloom filter in a single Redis round-trip.
///
/// Returns a `HashSet` of eids that are **already present** in either today's
/// or yesterday's window (i.e. confirmed duplicates). A Redis failure is
/// treated as fail-open (empty duplicate set).
async fn check_bloom<C>(
    redis: &mut C,
    bloom_key_prefix: &str,
    eids: &[&str],
) -> Result<HashSet<String>, AppError>
where
    C: ConnectionLike,
{
    if eids.is_empty() {
        return Ok(HashSet::new());
    }
    let (today_key, yesterday_key) = bloom_window_keys(bloom_key_prefix, Utc::now());

    // One pipeline: 2 × N BF.EXISTS commands — single RTT regardless of batch size.
    let mut pipe = redis::pipe();
    for &eid in eids {
        pipe.cmd("BF.EXISTS").arg(&today_key).arg(eid);
        pipe.cmd("BF.EXISTS").arg(&yesterday_key).arg(eid);
    }

    let results: Vec<i64> = pipe.query_async(redis).await?;

    let mut duplicates = HashSet::new();
    for (i, &eid) in eids.iter().enumerate() {
        if results[i * 2] == 1 || results[i * 2 + 1] == 1 {
            duplicates.insert(eid.to_string());
        }
    }

    metrics::counter!("ingestion_bloom_batch_rtt_total").increment(1);
    metrics::histogram!("ingestion_bloom_dedup_batch_size").record(eids.len() as f64);

    Ok(duplicates)
}

/// Record produced eids in the Bloom filter with a single BF.INSERT call.
///
/// `BF.INSERT` with CAPACITY + ERROR + EXPANSION 0 is idempotent: it creates
/// the filter with the configured capacity and FPP on first call, or uses the
/// existing filter on subsequent calls. EXPANSION 0 disables auto-scaling
/// (fixed-capacity, predictable memory).
///
/// Only eids that were **successfully produced** should be passed here — do
/// not record eids that were dropped for validation, quota, or size reasons.
async fn record_bloom<C>(
    redis: &mut C,
    bloom_key_prefix: &str,
    capacity: u64,
    fpp: f64,
    eids: &[String],
) -> Result<(), AppError>
where
    C: ConnectionLike,
{
    if eids.is_empty() {
        return Ok(());
    }
    let (today_key, _) = bloom_window_keys(bloom_key_prefix, Utc::now());

    // BF.INSERT creates the filter if absent (CAPACITY/ERROR set on creation),
    // then adds all items atomically. EXPIRE refreshes the 48 h TTL.
    let mut pipe = redis::pipe();
    pipe.cmd("BF.INSERT")
        .arg(&today_key)
        .arg("CAPACITY")
        .arg(capacity)
        .arg("ERROR")
        .arg(fpp)
        .arg("EXPANSION")
        .arg(0u64)
        .arg("ITEMS");
    for eid in eids {
        pipe.arg(eid.as_str());
    }
    pipe.ignore();
    pipe.cmd("EXPIRE")
        .arg(&today_key)
        .arg(BLOOM_KEY_TTL_SECS)
        .ignore();

    let (): () = pipe.query_async(redis).await?;
    Ok(())
}

/// Per-event legacy path used when `batch_bloom_enabled = false`.
async fn is_duplicate<C>(redis: &mut C, bloom_key_prefix: &str, eid: &str) -> Result<bool, AppError>
where
    C: ConnectionLike,
{
    let (today_key, yesterday_key) = bloom_window_keys(bloom_key_prefix, Utc::now());

    // Single pipeline round-trip:
    //   1. Check today's window   — exists_today
    //   2. Check yesterday's window — exists_yesterday (cross-midnight dedup)
    //   3. Record in today's window (only if not already present)
    //   4. Refresh TTL on today's key (48 h from last write for that date)
    let (exists_today, exists_yesterday, _added, _expire): (i64, i64, i64, i64) = redis::pipe()
        .cmd("BF.EXISTS").arg(&today_key).arg(eid)
        .cmd("BF.EXISTS").arg(&yesterday_key).arg(eid)
        .cmd("BF.ADD").arg(&today_key).arg(eid)
        .cmd("EXPIRE").arg(&today_key).arg(BLOOM_KEY_TTL_SECS)
        .query_async(redis)
        .await?;

    Ok(exists_today == 1 || exists_yesterday == 1)
}

// ─── DLQ helper (Phase 7) ────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn send_to_dlq(
    sink: &dyn Sink,
    dlq_topic: &str,
    eid: &str,
    event_name: &str,
    error: &str,
    store_id: u32,
    source: &str,
    server_received_at: i64,
) {
    let msg = serde_json::json!({
        "eid": eid,
        "t": event_name,
        "store_id": store_id,
        "error": error,
    });
    let headers = SinkHeaders::for_dlq(store_id, source, event_name, server_received_at, error);
    if let Err(e) = sink.send(dlq_topic, eid, &msg.to_string(), &headers).await {
        warn!(eid, error = %e, "Failed to send invalid event to DLQ");
    }
}

// ─── Core pipeline ───────────────────────────────────────────────────────────

pub async fn process_envelope<C>(
    envelope: TrackingEnvelope,
    store_id: u32,
    source: String,
    ip: String,
    ctx: &PipelineContext<'_>,
    redis: &mut C,
) -> Result<BatchResult, AppError>
where
    C: ConnectionLike,
{
    let config = ctx.config;
    let sink = ctx.sink;
    let overflow_limiter = ctx.overflow_limiter;
    let quota_limiter = ctx.quota_limiter;
    let restriction_store = ctx.restriction_store;

    let server_received_at = Utc::now().timestamp_millis();
    let mut result = BatchResult::new();

    // Batch size metric
    metrics::histogram!("ingestion_batch_size").record(envelope.events.len() as f64);

    // Clamp skew to ±30 min to ignore pathological clock drift.
    let raw_skew = server_received_at - envelope.sent_at;
    let skew = raw_skew.clamp(-1_800_000, 1_800_000);

    // Clock skew metric
    metrics::histogram!("ingestion_clock_skew_seconds")
        .record((raw_skew.unsigned_abs() as f64) / 1_000.0);

    // ── Batch bloom check (1 RTT for the whole envelope) ─────────────────────
    // Collect all eids upfront so we can pipeline all BF.EXISTS checks.
    let duplicate_eids: HashSet<String> = if config.batch_bloom_enabled {
        let all_eids: Vec<&str> = envelope.events.iter().map(|e| e.eid.as_str()).collect();
        match check_bloom(redis, &config.redis_bloom_key, &all_eids).await {
            Ok(dups) => dups,
            Err(e) => {
                warn!(error = %e, "Batch bloom check failed — proceeding without dedup");
                HashSet::new()
            }
        }
    } else {
        HashSet::new() // per-event path used below
    };

    let mut produced_eids: Vec<String> = Vec::new();

    for event in envelope.events {
        // Save eid before any field moves.
        let eid = event.eid.clone();

        // ── Step 1: Validate ─────────────────────────────────────────────
        if let Err(ref e) = validate(&event) {
            warn!(eid = %eid, error = %e, "Dropping invalid event");
            report_dropped_event("invalid");
            send_to_dlq(
                sink.as_ref(),
                &config.kafka_topic_dlq,
                &eid,
                &event.t,
                &e.to_string(),
                store_id,
                &source,
                server_received_at,
            )
            .await;
            result.push(eid, EventOutcome::Drop, Some("validation_failed"));
            continue;
        }

        // ── Step 2: Bloom filter deduplication ───────────────────────────
        if config.batch_bloom_enabled {
            if duplicate_eids.contains(&eid) {
                debug!(eid = %eid, "Dropping duplicate event");
                report_dropped_event("duplicate");
                result.push(eid, EventOutcome::Drop, Some("duplicate"));
                continue;
            }
        } else {
            // Legacy per-event path (batch_bloom_enabled = false).
            match is_duplicate(redis, &config.redis_bloom_key, &eid).await {
                Ok(true) => {
                    debug!(eid = %eid, "Dropping duplicate event");
                    report_dropped_event("duplicate");
                    result.push(eid, EventOutcome::Drop, Some("duplicate"));
                    continue;
                }
                Ok(false) => {}
                Err(e) => {
                    warn!(eid = %eid, error = %e, "Redis dedup check failed, proceeding without dedup");
                }
            }
        }

        // ── Step 2.5: Illegal distinct-ID check ─────────────────────────────
        // Accept the event but disable person processing to protect the
        // identity graph from SDK placeholder IDs.
        let force_disable_person_processing = is_illegal_id(&event.anon)
            || event.uid.as_deref().is_some_and(is_illegal_id);
        if force_disable_person_processing {
            metrics::counter!("ingestion_illegal_id_total").increment(1);
            warn!(eid = %eid, anon = %event.anon, "Illegal distinct ID — person processing disabled");
        }

        // ── Step 2.6: Quota check ─────────────────────────────────────────
        let quota_bucket = QuotaBucket::from_event_type(&event.t);
        if quota_limiter.is_exceeded(store_id, quota_bucket).await {
            metrics::counter!(
                "ingestion_quota_exceeded_total",
                "bucket" => quota_bucket.as_str()
            )
            .increment(1);
            debug!(
                eid = %eid,
                store_id,
                bucket = quota_bucket.as_str(),
                "Event dropped: store quota exceeded"
            );
            result.push(eid, EventOutcome::Drop, Some("quota_exceeded"));
            continue;
        }

        // ── Step 2.7: Event restriction check ───────────────────────────────
        if restriction_store.is_restricted(store_id, &event.t).await {
            metrics::counter!("ingestion_restricted_event_total").increment(1);
            debug!(
                eid = %eid,
                store_id,
                event_type = %event.t,
                "Event dropped: restricted event type"
            );
            result.push(eid, EventOutcome::Drop, Some("restricted"));
            continue;
        }

        // ── Step 3: Clock-skew correction ────────────────────────────────
        // Save options before event is moved into ServerEvent.
        let cookieless_mode = event.options.cookieless_mode;
        let process_person_profile = event.options.process_person_profile;
        let adjusted_ts = if event.options.disable_skew_correction {
            event.ts
        } else {
            event.ts + skew
        };

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
            cookieless_mode,
            process_person_profile,
        };

        // ── Step 5: Serialize ─────────────────────────────────────────────
        let payload = serde_json::to_string(&server_event)
            .map_err(|e| AppError::InternalError(format!("serialization failed: {e}")))?;

        // ── Step 6: Size check ────────────────────────────────────────────
        if payload.len() > config.max_event_bytes {
            warn!(
                eid = %eid,
                bytes = payload.len(),
                max = config.max_event_bytes,
                "Dropping oversized event"
            );
            report_dropped_event("too_big");
            let dlq_msg = serde_json::json!({
                "eid": eid,
                "t": server_event.t,
                "store_id": server_event.store_id,
                "error": format!("event payload too large: {} bytes (max {})", payload.len(), config.max_event_bytes),
            });
            let dlq_headers = SinkHeaders {
                store_id,
                source: source.clone(),
                anon_id: server_event.anon.clone(),
                session_id: server_event.sid.clone(),
                event_type: server_event.t.clone(),
                adjusted_ts: server_event.adjusted_ts,
                server_received_at,
                force_disable_person_processing: false,
                historical_migration: false,
                dlq_reason: Some("too_big".to_string()),
                cookieless_mode: server_event.cookieless_mode,
                process_person_profile: server_event.process_person_profile,
            };
            let _ = sink
                .send(
                    &config.kafka_topic_dlq,
                    &server_event.sid,
                    &dlq_msg.to_string(),
                    &dlq_headers,
                )
                .await;
            result.push(eid, EventOutcome::Drop, Some("too_big"));
            continue;
        }

        // ── Step 7: Historical rerouting ──────────────────────────────────
        let age_ms = server_received_at - server_event.adjusted_ts;
        let is_historical =
            config.historical_rerouting_enabled && age_ms > config.historical_threshold_ms();

        // ── Step 8: Overflow routing ──────────────────────────────────────
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

        // ── Step 10: Produce ─────────────────────────────────────────────
        let sink_headers = SinkHeaders {
            store_id,
            source: source.clone(),
            anon_id: server_event.anon.clone(),
            session_id: server_event.sid.clone(),
            event_type: server_event.t.clone(),
            adjusted_ts: server_event.adjusted_ts,
            server_received_at,
            force_disable_person_processing,
            historical_migration: is_historical,
            dlq_reason: None,
            cookieless_mode,
            process_person_profile,
        };
        let start = std::time::Instant::now();
        match sink.send(topic, &partition_key, &payload, &sink_headers).await {
            Ok(()) => {
                metrics::histogram!("ingestion_produce_duration_seconds")
                    .record(start.elapsed().as_secs_f64());
                metrics::histogram!("ingestion_event_payload_bytes").record(payload.len() as f64);
                metrics::counter!("ingestion_events_accepted_total").increment(1);
                // Track eid for batch bloom write (only successfully produced events).
                if config.batch_bloom_enabled {
                    produced_eids.push(eid.clone());
                }
                if force_disable_person_processing {
                    result.push(eid, EventOutcome::Warning, Some("illegal_id"));
                } else {
                    result.push(eid, EventOutcome::Ok, None);
                }
            }
            Err(e) => {
                warn!(eid = %eid, error = %e, "Kafka produce failed — marking event for retry");
                report_dropped_event("kafka_error");
                result.push(eid, EventOutcome::Retry, Some("not_persisted"));
            }
        }
    }

    // ── Batch bloom write (1 RTT for all produced eids) ──────────────────────
    if config.batch_bloom_enabled && !produced_eids.is_empty() {
        if let Err(e) = record_bloom(
            redis,
            &config.redis_bloom_key,
            config.bloom_filter_capacity,
            config.bloom_filter_fpp,
            &produced_eids,
        )
        .await
        {
            warn!(error = %e, "Batch bloom record failed — duplicates may slip through");
        }
    }

    Ok(result)
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
            options: EventOptions::default(),
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

    #[test]
    fn event_options_all_default_false() {
        let opts: EventOptions = serde_json::from_str("{}").unwrap();
        assert!(!opts.disable_skew_correction);
        assert!(!opts.cookieless_mode);
        assert!(!opts.process_person_profile);
    }

    #[test]
    fn event_options_disable_skew_correction_parsed() {
        let opts: EventOptions =
            serde_json::from_str(r#"{"disable_skew_correction":true}"#).unwrap();
        assert!(opts.disable_skew_correction);
        assert!(!opts.cookieless_mode);
        assert!(!opts.process_person_profile);
    }

    #[test]
    fn event_options_cookieless_and_person_profile_parsed() {
        let opts: EventOptions =
            serde_json::from_str(r#"{"cookieless_mode":true,"process_person_profile":true}"#)
                .unwrap();
        assert!(!opts.disable_skew_correction);
        assert!(opts.cookieless_mode);
        assert!(opts.process_person_profile);
    }

    #[test]
    fn bloom_key_rotation_correct_format() {
        use chrono::TimeZone;
        let now = Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap();
        let (today, yesterday) = bloom_window_keys("idem:bloom", now);
        assert_eq!(today, "idem:bloom:20260701");
        assert_eq!(yesterday, "idem:bloom:20260630");
    }

    #[test]
    fn bloom_key_rotation_crosses_year_boundary() {
        use chrono::TimeZone;
        let jan_1 = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let (today, yesterday) = bloom_window_keys("idem:bloom", jan_1);
        assert_eq!(today, "idem:bloom:20260101");
        assert_eq!(yesterday, "idem:bloom:20251231");
    }
}
