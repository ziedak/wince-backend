import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';
import type { EnrichedEvent } from '@org/types';

export interface SessionContext {
  sid: string;
  storeId: number;
  customerId: number | null;
  /** Stored as `distinct_id` by enrichment-session; maps to `anon` in EnrichedEvent. */
  distinctId: string;
  anon: string;
  uid?: string;
  email?: string;
  emailConsent: boolean;
  smsConsent: boolean;
  cartValue: number;
  rageClickCount: number;
  lastActivity: number;
  isFrustrated: boolean;
  /** True when last activity is within the last 2 minutes. */
  sessionAvailable: boolean;
}

/**
 * Reads real-time session state from the Redis session hash written by enrichment-session.
 *
 * The hash (`session:{sid}`) contains both mutable session state (cart_value, is_frustrated)
 * and stable identity context (store_id, customer_id, distinct_id) set by enrichment-session
 * on the first event of each session. This allows the scheduler worker and stale scanner
 * to reconstruct a valid EnrichedEvent without a Kafka message.
 */
export class SessionFeaturesService {
  private readonly logger = createLogger({ service: 'SessionFeaturesService' });

  constructor(private readonly redis: RedisClient) {}

  /**
   * Reads full session state from the `session:{sessionId}` Redis hash.
   * Returns null when the hash has expired or context fields are not yet written.
   */
  async getSessionContext(sessionId: string): Promise<SessionContext | null> {
    try {
      const data = await this.redis.getRedis().hgetall(`session:${sessionId}`);
      if (!data || Object.keys(data).length === 0) return null;

      const storeId = parseInt(data['store_id'] ?? '0', 10);
      const distinctId = data['distinct_id'] ?? '';
      if (!storeId || !distinctId) return null; // context fields not yet written by enrichment-session

      const customerId = data['customer_id'] ? parseInt(data['customer_id'], 10) : null;
      const cartValue = parseFloat(data['cart_value'] ?? '0');
      const rageClickCount = parseInt(data['rage_click_count'] ?? '0', 10);
      const lastActivity = parseInt(data['last_activity'] ?? '0', 10);
      const isFrustrated = data['is_frustrated'] === '1';
      const sessionAvailable = lastActivity > 0 && Date.now() - lastActivity < 120_000;

      return {
        sid: sessionId,
        storeId,
        customerId,
        distinctId,
        anon: data['anon'] ?? distinctId,
        uid: data['uid'] !== undefined && data['uid'] !== '' ? data['uid'] : undefined,
        email: data['email'] !== undefined && data['email'] !== '' ? data['email'] : undefined,
        emailConsent: data['email_consent'] === '1',
        smsConsent: data['sms_consent'] === '1',
        cartValue,
        rageClickCount,
        lastActivity,
        isFrustrated,
        sessionAvailable,
      };
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'SessionFeaturesService: failed to read session context');
      return null;
    }
  }

  /**
   * Builds a synthetic EnrichedEvent from a SessionContext for the decision orchestrator.
   * The `eid` is unique per call to prevent intervention ID collisions across re-evaluations.
   */
  toEnrichedEvent(ctx: SessionContext): EnrichedEvent {
    const nowMs = Date.now();
    return {
      eid: `reeval-${ctx.sid}-${nowMs}`,
      seq: 0,
      t: 'idle_timeout',
      ts: ctx.lastActivity,
      sid: ctx.sid,
      anon: ctx.anon,
      uid: ctx.uid,
      store_id: ctx.storeId,
      source: 'backend',
      server_received_at: nowMs,
      adjusted_ts: ctx.lastActivity,
      ip: '',
      customer_id: ctx.customerId,
      cart_value: ctx.cartValue,
      rage_click_count: ctx.rageClickCount,
      is_frustrated: ctx.isFrustrated,
      lifetime_value: 0,
      email: ctx.email,
      email_consent: ctx.emailConsent,
      sms_consent: ctx.smsConsent,
      session_available: ctx.sessionAvailable,
    };
  }
}
