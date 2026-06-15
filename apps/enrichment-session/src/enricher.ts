import type { Logger } from '@org/logger';
import type { IdempotencyService } from './idempotency.js';
import type { SessionService } from './session.js';
import type { CustomerService } from './customer.js';
import type { EnrichmentMetrics } from './metrics.js';
import type { RawEvent, EnrichResult, EnrichedEvent } from './types.js';

function cartValueDeltaFor(eventType: string, cartValue: number | undefined): number {
  if (eventType === 'add_to_cart') return cartValue ?? 0;
  if (eventType === 'remove_from_cart') return -(cartValue ?? 0);
  return 0;
}

export class Enricher {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly session: SessionService,
    private readonly customer: CustomerService,
    private readonly metrics: EnrichmentMetrics,
    private readonly logger: Logger,
  ) {}

  async enrich(raw: RawEvent): Promise<EnrichResult> {
    if (await this.idempotency.isDuplicate(raw.event_id)) {
      return { kind: 'duplicate' };
    }

    const nowMs = Date.now();

    // Customer lookup — non-fatal
    let customerData = null;
    try {
      customerData = await this.customer.getOrCreate(raw.store_id, raw.distinct_id);
    } catch (err) {
      this.logger.warn({ err, event_id: raw.event_id }, 'Customer lookup failed, continuing without customer data');
    }

    // Session update — non-fatal; degrade to session_available: false on outage
    let sessionState = null;
    let sessionAvailable = true;
    try {
      const t0 = Date.now();
      sessionState = await this.session.updateSession(
        raw.session_id,
        raw.event_type,
        cartValueDeltaFor(raw.event_type, raw.cart_value),
        nowMs,
      );
      this.metrics.dbQueryLatency('session_update', Date.now() - t0);
    } catch (err) {
      this.logger.error({ err, event_id: raw.event_id }, 'Redis session update failed, degrading gracefully');
      sessionAvailable = false;
    }

    const enriched: EnrichedEvent = {
      ...raw,
      customer_id: customerData?.id ?? null,
      lifetime_value: customerData?.lifetimeValue ?? 0,
      email_consent: customerData?.emailConsent ?? false,
      sms_consent: customerData?.smsConsent ?? false,
      rage_click_count: sessionState?.rageClickCount ?? 0,
      is_frustrated: sessionState?.isFrustrated ?? false,
      session_available: sessionAvailable,
      server_timestamp: new Date(nowMs).toISOString(),
    };

    return { kind: 'enriched', event: enriched };
  }
}
