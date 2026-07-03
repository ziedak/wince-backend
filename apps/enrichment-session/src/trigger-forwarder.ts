import { createLogger } from '@org/logger';
import type { EnrichedEvent as LocalEnrichedEvent } from './types.js';

/** Event types that bypass Kafka and are forwarded directly to the decision-engine. */
const TRIGGER_EVENTS = new Set([
  'checkout_abandon',
  'exit_intent',
  'rage_click',
  'add_to_cart',
]);

const FORWARD_TIMEOUT_MS = 500;

/**
 * Forwards trigger events directly to the decision-engine's `/v1/trigger` endpoint,
 * bypassing the Kafka round-trip to achieve sub-100ms end-to-end latency.
 *
 * All events are still published to Kafka by the caller for durability and analytics.
 * This class handles only the low-latency fast path.
 *
 * The local enrichment-session event schema is mapped to the canonical `@org/types::EnrichedEvent`
 * field names that the decision-engine expects.
 */
export class TriggerForwarder {
  private readonly logger = createLogger({ service: 'TriggerForwarder' });
  private readonly triggerUrl: string;

  constructor(
    decisionEngineUrl: string,
    private readonly internalSecret: string,
  ) {
    this.triggerUrl = `${decisionEngineUrl.replace(/\/$/, '')}/v1/trigger`;
  }

  /**
   * Forwards the event if it is a trigger type.
   * Always resolves — errors are logged but never propagate to the caller.
   */
  async maybeForward(event: LocalEnrichedEvent): Promise<void> {
    if (!TRIGGER_EVENTS.has(event.event_type)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);

    try {
      const body = JSON.stringify(this.toCanonicalEvent(event));
      const response = await fetch(this.triggerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.internalSecret,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 202) {
        this.logger.warn(
          { status: response.status, session_id: event.session_id },
          'TriggerForwarder: non-202 response from decision-engine',
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        this.logger.warn(
          { session_id: event.session_id, timeoutMs: FORWARD_TIMEOUT_MS },
          'TriggerForwarder: request timed out (Kafka path will handle this event)',
        );
      } else {
        this.logger.warn(
          { err, session_id: event.session_id },
          'TriggerForwarder: forward failed (non-fatal, Kafka path provides durability)',
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Maps enrichment-session's local event shape to the canonical @org/types::EnrichedEvent
   * field names that the decision-engine's TriggerHandler and DecisionOrchestrator expect.
   */
  private toCanonicalEvent(e: LocalEnrichedEvent): Record<string, unknown> {
    const tsMs = e.timestamp ? new Date(e.timestamp).getTime() : Date.now();
    return {
      // TrackEvent fields
      eid: e.event_id,
      seq: 0,
      t: e.event_type,
      ts: tsMs,
      sid: e.session_id,
      anon: e.distinct_id,
      props: e.properties,
      // RawKafkaEvent fields
      store_id: e.store_id,
      source: 'backend',
      server_received_at: Date.now(),
      adjusted_ts: tsMs,
      ip: '',
      // EnrichedEvent fields
      customer_id: e.customer_id,
      cart_value: e.cart_value ?? 0,
      rage_click_count: e.rage_click_count,
      is_frustrated: e.is_frustrated,
      lifetime_value: e.lifetime_value,
      email: e.customer_email,
      email_consent: e.email_consent,
      sms_consent: e.sms_consent,
      session_available: e.session_available,
    };
  }
}
