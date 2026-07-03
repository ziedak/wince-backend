import type { RedisClient } from '@org/redis_client';
import type { SessionState } from './types.js';

const RAGE_WINDOW_MS = 30_000;
const RAGE_THRESHOLD = 3;
const MAX_RAGE_TIMESTAMPS = 10;

/** Context fields written once per session for downstream consumers (decision-engine stale scanner). */
export interface SessionContext {
  storeId: number;
  customerId: number | null;
  distinctId: string;
  anon?: string;
  uid?: string;
  email?: string;
  emailConsent: boolean;
  smsConsent: boolean;
}

export class SessionService {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlSeconds: number,
  ) {}

  async updateSession(
    sessionId: string,
    eventType: string,
    cartValueDelta: number,
    nowMs: number,
  ): Promise<SessionState> {
    const raw = this.redis.getRedis();
    const sessionKey = `session:${sessionId}`;
    const rageTsKey = `session:${sessionId}:rage_ts`;

    const isRageClick = eventType === 'rage_click';

    // Pipeline: update hash fields atomically
    const pipeline = raw.pipeline();
    if (cartValueDelta !== 0) {
      pipeline.hincrbyfloat(sessionKey, 'cart_value', cartValueDelta);
    }
    if (isRageClick) {
      pipeline.hincrby(sessionKey, 'rage_click_count', 1);
    }
    pipeline.hset(sessionKey, 'last_activity', nowMs);
    pipeline.expire(sessionKey, this.ttlSeconds);

    // Track this session in the active:sessions sorted set (used by stale scanner)
    pipeline.zadd('active:sessions', nowMs, sessionId);

    if (isRageClick) {
      pipeline.lpush(rageTsKey, nowMs);
      pipeline.ltrim(rageTsKey, 0, MAX_RAGE_TIMESTAMPS - 1);
      pipeline.expire(rageTsKey, this.ttlSeconds);
    }

    await pipeline.exec();

    // Read back current state — hgetall returns null for a missing key
    const [hashData, rageTimestamps] = await Promise.all([
      raw.hgetall(sessionKey),
      raw.lrange(rageTsKey, 0, -1),
    ]);

    const cartValue = parseFloat(hashData?.['cart_value'] ?? '0');
    const rageClickCount = parseInt(hashData?.['rage_click_count'] ?? '0', 10);
    const lastActivity = parseInt(hashData?.['last_activity'] ?? String(nowMs), 10);

    // Sliding window: count rage clicks in last RAGE_WINDOW_MS
    const recentRageClicks = rageTimestamps.filter(
      (ts) => nowMs - parseInt(ts, 10) <= RAGE_WINDOW_MS,
    ).length;
    const isFrustrated = recentRageClicks >= RAGE_THRESHOLD;

    // Persist is_frustrated so the decision-engine can read it without recomputing
    await raw.hset(sessionKey, 'is_frustrated', isFrustrated ? '1' : '0');

    return { cartValue, rageClickCount, lastActivity, isFrustrated };
  }

  /**
   * Writes stable identity context fields to the session hash.
   * Called by the Enricher after resolving customer data so the decision-engine's
   * scheduler worker and stale scanner can reconstruct a full event without Kafka.
   * Uses HSET (overwrites) so the latest resolved customer_id is always stored.
   */
  async setContext(sessionId: string, ctx: SessionContext): Promise<void> {
    const raw = this.redis.getRedis();
    const sessionKey = `session:${sessionId}`;
    await raw.hset(sessionKey, {
      store_id: String(ctx.storeId),
      customer_id: ctx.customerId !== null ? String(ctx.customerId) : '',
      distinct_id: ctx.distinctId,
      anon: ctx.anon ?? ctx.distinctId,
      uid: ctx.uid ?? '',
      email: ctx.email ?? '',
      email_consent: ctx.emailConsent ? '1' : '0',
      sms_consent: ctx.smsConsent ? '1' : '0',
    });
  }
}
