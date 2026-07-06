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
                // On Redis outage, treat as duplicate to prevent double-processing.
                tracing::warn!(error = %e, event_id = %raw.event_id, "window update failed (Redis)");
                return EnrichResult::Duplicate;
            }
        };

        // ── 2. Customer lookup (non-fatal) ────────────────────────────────────────
        let customer_data = match self.customer.get_or_create(raw.store_id, &raw.distinct_id).await {
            Ok(data) => data,
            Err(_) => None,
        };

        // ── 3. Build enriched event ───────────────────────────────────────────────
        // Keep legacy fields for backward compatibility with TS consumers.
        let rage_click_count = fv.rage_clicks_30s as i32;
        let is_frustrated    = fv.rage_after_add || fv.rage_clicks_30s >= 3;

        let enriched = EnrichedEvent {
            event_id:       raw.event_id.clone(),
            event_type:     raw.event_type.clone(),
            session_id:     raw.session_id.clone(),
            distinct_id:    raw.distinct_id.clone(),
            store_id:       raw.store_id,
            timestamp:      raw.timestamp,
            cart_value:     raw.cart_value,
            customer_email: raw.customer_email,
            properties:     raw.properties,

            customer_id:    customer_data.as_ref().map(|c| c.id),
            lifetime_value: customer_data.as_ref().map(|c| c.lifetime_value).unwrap_or(0.0),
            email_consent:  customer_data.as_ref().map(|c| c.email_consent).unwrap_or(false),
            sms_consent:    customer_data.as_ref().map(|c| c.sms_consent).unwrap_or(false),
            rage_click_count,
            is_frustrated,
            session_available: true,
            server_timestamp: chrono::Utc::now().to_rfc3339(),
            features: Some(fv),
        };

        self.metrics.processing_latency(t0.elapsed().as_millis() as f64);

        // ── 4. Fire-and-forget identity context write ─────────────────────────────
        let ctx = SessionContext {
            store_id:      raw.store_id,
            customer_id:   customer_data.as_ref().map(|c| c.id),
            distinct_id:   raw.distinct_id.clone(),
            anon:          Some(raw.distinct_id),
            uid:           None,
            email:         customer_data.as_ref().and_then(|c| c.email.clone()),
            email_consent: customer_data.as_ref().map(|c| c.email_consent).unwrap_or(false),
            sms_consent:   customer_data.as_ref().map(|c| c.sms_consent).unwrap_or(false),
        };
        let session    = self.session.clone();
        let session_id = raw.session_id;
        tokio::spawn(async move {
            if let Err(e) = session.set_context(&session_id, ctx).await {
                tracing::warn!(error = %e, session_id = session_id, "set_context failed (non-fatal)");
            }
        });

        EnrichResult::Enriched(enriched)
    }
}
