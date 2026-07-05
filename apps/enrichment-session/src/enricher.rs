use std::sync::Arc;

use crate::metrics::EnrichmentMetrics;
use crate::session::SessionContext;
use rust_shared_types::{EnrichResult, EnrichedEvent, RawEvent};

pub struct Enricher {
    idempotency: Arc<IdempotencyService>,
    session: Arc<SessionService>,
    customer: Arc<CustomerService>,
    metrics: Arc<EnrichmentMetrics>,
}

impl Enricher {
    pub fn new(
        idempotency: Arc<IdempotencyService>,
        session: Arc<SessionService>,
        customer: Arc<CustomerService>,
        metrics: Arc<EnrichmentMetrics>,
    ) -> Self {
        Self { idempotency, session, customer, metrics }
    }

    /// Enrich a raw event. Returns enriched event or duplicate marker.
    pub async fn enrich(&self, raw: RawEvent) -> EnrichResult {
        let session_id_for_context = raw.session_id.clone();
        let distinct_id_for_context = raw.distinct_id.clone();

        // Check for duplicate
        if self.idempotency.is_duplicate(&raw.event_id, raw.store_id).await.unwrap_or(false) {
            return EnrichResult::Duplicate;
        }

        let now_ms = chrono::Utc::now().timestamp_millis();

        // Customer lookup — non-fatal
        let customer_data = match self.customer.get_or_create(raw.store_id, &raw.distinct_id).await {
            Ok(data) => data,
            Err(_) => None,
        };

        // Session update — non-fatal; degrade to session_available: false on outage
        let mut session_state = None;
        let mut session_available = true;
        let t0_session = std::time::Instant::now();
        match self.session.update_session(
            &raw.session_id,
            &raw.event_type,
            cart_value_delta_for(&raw.event_type, raw.cart_value),
            now_ms,
        ).await {
            Ok(state) => {
                self.metrics.db_query_latency("session_update", t0_session.elapsed().as_millis() as f64);
                session_state = Some(state);
            }
            Err(_) => {
                session_available = false;
            }
        }

        let enriched = EnrichedEvent {
            event_id: raw.event_id,
            event_type: raw.event_type,
            session_id: raw.session_id,
            distinct_id: raw.distinct_id,
            store_id: raw.store_id,
            timestamp: raw.timestamp,
            cart_value: raw.cart_value,
            customer_email: raw.customer_email,
            properties: raw.properties,

            customer_id: customer_data.as_ref().map(|c| c.id),
            lifetime_value: customer_data.as_ref().map(|c| c.lifetime_value).unwrap_or(0.0),
            email_consent: customer_data.as_ref().map(|c| c.email_consent).unwrap_or(false),
            sms_consent: customer_data.as_ref().map(|c| c.sms_consent).unwrap_or(false),
            rage_click_count: session_state.as_ref().map(|s| s.rage_click_count).unwrap_or(0),
            is_frustrated: session_state.as_ref().map(|s| s.is_frustrated).unwrap_or(false),
            session_available,
            server_timestamp: chrono::Utc::now().to_rfc3339(),
        };

        // Persist identity context (non-fatal fire-and-forget)
        let ctx = SessionContext {
            store_id: raw.store_id,
            customer_id: customer_data.as_ref().map(|c| c.id),
            distinct_id: distinct_id_for_context.clone(),
            // anon mirrors distinct_id for anonymous visitors; uid is empty until auth resolves
            anon: Some(distinct_id_for_context),
            uid: None,
            email: customer_data.as_ref().and_then(|c| c.email.clone()),
            email_consent: customer_data.as_ref().map(|c| c.email_consent).unwrap_or(false),
            sms_consent: customer_data.as_ref().map(|c| c.sms_consent).unwrap_or(false),
        };
        
        let session = self.session.clone();
        let session_id = session_id_for_context;
        tokio::spawn(async move {
            if let Err(e) = session.set_context(&session_id, ctx).await {
                tracing::warn!(error = %e, session_id = session_id, "setContext failed (non-fatal)");
            }
        });

        EnrichResult::Enriched(enriched)
    }
}

fn cart_value_delta_for(event_type: &str, cart_value: Option<f64>) -> f64 {
    match event_type {
        "add_to_cart" => cart_value.unwrap_or(0.0),
        "remove_from_cart" => -(cart_value.unwrap_or(0.0)),
        _ => 0.0,
    }
}

use crate::{idempotency::IdempotencyService, session::SessionService, customer::CustomerService};