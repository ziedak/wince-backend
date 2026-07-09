//! Sink abstraction layer.
//!
//! All event-producing code in `pipeline.rs` talks to a `&dyn Sink` rather
//! than directly to `rdkafka`. This makes the Kafka sink swappable with the
//! S3 fallback sink or a no-op sink for tests.

use async_trait::async_trait;

use crate::errors::AppError;

pub mod fallback;
pub mod kafka;
pub mod s3;
pub mod wal;

/// Typed metadata attached to every produced message as Kafka headers.
///
/// Downstream consumers (`analytics-consumer`, `enrichment-session`) can read
/// routing decisions and enrichment fields from headers without deserializing
/// the full JSON payload body, which reduces per-message CPU overhead.
///
/// Non-Kafka sinks (e.g. S3 fallback) ignore these headers — the same data
/// is already present inside the JSON body produced by the pipeline.
#[derive(Debug, Clone)]
pub struct SinkHeaders {
    /// Tenant identifier injected by Kong.
    pub store_id: u32,
    /// Event origin: `"browser"` or `"backend"`.
    pub source: String,
    /// Anonymous user ID — used by consumers for person-merge decisions.
    pub anon_id: String,
    /// Session ID — Kafka partition key for normal events.
    pub session_id: String,
    /// Event type name (`t` field from the wire format).
    pub event_type: String,
    /// Clock-skew-adjusted client timestamp in Unix milliseconds.
    pub adjusted_ts: i64,
    /// Server ingestion timestamp in Unix milliseconds.
    pub server_received_at: i64,
    /// When `true`, downstream consumers must skip person profile updates
    /// (set for illegal anon_ids and force-overflow events).
    pub force_disable_person_processing: bool,
    /// When `true`, this event is part of a historical data migration batch.
    pub historical_migration: bool,
    /// Non-`None` when the event is routed to the DLQ; contains the reason.
    pub dlq_reason: Option<String>,
    /// Forwarded from [`EventOptions::cookieless_mode`]: downstream consumers
    /// should skip cross-session identity resolution.
    pub cookieless_mode: bool,
    /// Forwarded from [`EventOptions::process_person_profile`]: explicit SDK
    /// request to create/update a person profile for this event.
    pub process_person_profile: bool,
    /// Delivery priority hint forwarded from the client SDK's `_priority`
    /// field (`critical` | `high` | `normal`), when present. Ingestion does
    /// not act on this — downstream consumers (e.g. decision-engine) use it
    /// to prioritize processing.
    pub priority: Option<String>,
}

impl SinkHeaders {
    /// Build minimal headers for a DLQ message when full event context is
    /// not yet available (e.g. validation failures before enrichment).
    pub fn for_dlq(
        store_id: u32,
        source: &str,
        event_type: &str,
        server_received_at: i64,
        dlq_reason: &str,
    ) -> Self {
        Self {
            store_id,
            source: source.to_string(),
            anon_id: String::new(),
            session_id: String::new(),
            event_type: event_type.to_string(),
            adjusted_ts: 0,
            server_received_at,
            force_disable_person_processing: false,
            historical_migration: false,
            dlq_reason: Some(dlq_reason.to_string()),
            cookieless_mode: false,
            process_person_profile: false,
            priority: None,
        }
    }
}

/// Minimal write interface shared by every sink implementation.
#[async_trait]
pub trait Sink: Send + Sync {
    /// Produce a single JSON-encoded event to the named topic.
    ///
    /// `key` is the Kafka partition key (session ID for normal events, empty
    /// string `""` for overflow events that should round-robin).
    ///
    /// `headers` carries routing metadata as typed message headers.
    /// Non-Kafka sinks may ignore `headers` — metadata is already present
    /// inside the serialised JSON `payload`.
    async fn send(
        &self,
        topic: &str,
        key: &str,
        payload: &str,
        headers: &SinkHeaders,
    ) -> Result<(), AppError>;
}
