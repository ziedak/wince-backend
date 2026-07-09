use std::sync::Arc;
use std::time::Instant;

use crate::customer::CustomerService;
use crate::metrics::EnrichmentMetrics;
use crate::session::{SessionContext, SessionService};
use crate::window::{WindowResult, WindowService};
use rust_shared_types::{EnrichResult, EnrichedEvent, RawEvent};

pub struct Enricher {
    window: Arc<WindowService>,
    session: Arc<SessionService>,
    customer: Arc<CustomerService>,
    metrics: Arc<EnrichmentMetrics>,
}

impl Enricher {
    pub fn new(
        window: Arc<WindowService>,
        session: Arc<SessionService>,
        customer: Arc<CustomerService>,
        metrics: Arc<EnrichmentMetrics>,
    ) -> Self {
        Self { window, session, customer, metrics }
    }

    pub async fn enrich(&self, raw: RawEvent) -> EnrichResult {
        let t0 = Instant::now();

        // ── 1. Atomic Lua window update (idempotency + feature extraction) ──────
        let fv = match self.window.update(&raw).await {
            Ok(WindowResult::Duplicate) => return EnrichResult::Duplicate,
            Ok(WindowResult::Features(fv)) => fv,
            Err(e) => {
                // On Redis outage, drop the event to prevent double-processing on retry.
                // This is deliberate at-most-once behaviour during degradation.
                tracing::error!(error = %e, event_id = %raw.eid, "window update failed — event dropped (Redis unavailable)");
                self.metrics.events_processed("redis_degraded");
                return EnrichResult::Duplicate;
            }
        };

        // ── 2. Customer lookup (non-fatal) ────────────────────────────────────────
        let customer_data = match self.customer.get_or_create(raw.store_id, &raw.anon).await {
            Ok(data) => data,
            Err(_) => None,
        };

        // ── 3. Build enriched event ───────────────────────────────────────────────
        // Keep legacy fields for backward compatibility with TS consumers.
        let rage_click_count = fv.rage_clicks_30s as i32;
        let is_frustrated    = fv.pattern_rage_after_add || fv.rage_clicks_30s >= 3;

        let enriched = EnrichedEvent {
            eid:            raw.eid.clone(),
            t:              raw.t.clone(),
            sid:            raw.sid.clone(),
            anon:           raw.anon.clone(),
            uid:            raw.uid.clone(),
            store_id:       raw.store_id,
            ts:             raw.ts,
            cart_value:     raw.cart_value().unwrap_or(0.0),
            email:          customer_data.as_ref().and_then(|c| c.email.clone()).or_else(|| raw.customer_email()),
            props:          raw.props.clone(),

            customer_id:    customer_data.as_ref().map(|c| c.id),
            lifetime_value: customer_data.as_ref().map(|c| c.lifetime_value).unwrap_or(0.0),
            email_consent:  customer_data.as_ref().map(|c| c.email_consent).unwrap_or(false),
            sms_consent:    customer_data.as_ref().map(|c| c.sms_consent).unwrap_or(false),
            rage_click_count,
            is_frustrated,
            session_available: true,
            server_timestamp: chrono::Utc::now().to_rfc3339(),
            priority: raw.priority.clone(),
            schema_v: raw.schema_v,
            features: Some(fv),
        };

        self.metrics.processing_latency(t0.elapsed().as_millis() as f64);

        // ── 4. Fire-and-forget identity context write ─────────────────────────────
        let ctx = SessionContext {
            store_id:      raw.store_id,
            customer_id:   customer_data.as_ref().map(|c| c.id),
            distinct_id:   raw.anon.clone(),
            anon:          Some(raw.anon.clone()),
            uid:           raw.uid.clone(),
            email:         customer_data.as_ref().and_then(|c| c.email.clone()),
            email_consent: customer_data.as_ref().map(|c| c.email_consent).unwrap_or(false),
            sms_consent:   customer_data.as_ref().map(|c| c.sms_consent).unwrap_or(false),
        };
        let session    = self.session.clone();
        let session_id = raw.sid;
        tokio::spawn(async move {
            if let Err(e) = session.set_context(&session_id, ctx).await {
                tracing::warn!(error = %e, session_id = session_id, "set_context failed (non-fatal)");
            }
        });

        EnrichResult::Enriched(enriched)
    }
}
