import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';

const SESSION_LOCK_TTL = 30;   // seconds — covers full intervention pipeline execution
const CART_LOCK_TTL = 300;     // 5 minutes — multi-tab protection per cart
const SENT_TTL = 300;          // 5 minutes — prevents re-send after session lock expires

/**
 * Manages Redis-backed concurrency guards for the intervention pipeline.
 *
 * Three layers of protection:
 *   1. Session lock  — prevents two concurrent decisions for the same session
 *   2. Cart lock     — prevents duplicate interventions across browser tabs sharing a cart
 *   3. Sent marker   — persists the "already intervened" state beyond the session lock TTL
 *
 * All operations fail-open on Redis error to avoid blocking interventions during outages.
 */
export class LockService {
  private readonly logger = createLogger({ service: 'LockService' });

  constructor(private readonly redis: RedisClient) {}

  /**
   * Acquires a per-session intervention lock (SET NX EX).
   * Returns true when the lock is acquired (safe to proceed).
   * Returns false when another decision is already in flight for this session.
   */
  async acquireSessionLock(sessionId: string): Promise<boolean> {
    try {
      const result = await this.redis.getRedis().set(
        `lock:intervention:${sessionId}`,
        '1',
        'EX',
        SESSION_LOCK_TTL,
        'NX',
      );
      return result === 'OK';
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'LockService: session lock check failed, allowing through');
      return true; // fail-open
    }
  }

  /**
   * Acquires a per-cart lock (SET NX EX).
   * Returns true when the lock is acquired.
   * Returns false when another intervention is already in flight for this cart (multi-tab scenario).
   */
  async acquireCartLock(cartId: string): Promise<boolean> {
    try {
      const result = await this.redis.getRedis().set(
        `lock:cart:${cartId}`,
        '1',
        'EX',
        CART_LOCK_TTL,
        'NX',
      );
      return result === 'OK';
    } catch (err) {
      this.logger.warn({ err, cartId }, 'LockService: cart lock check failed, allowing through');
      return true; // fail-open
    }
  }

  /** Records that an intervention was successfully sent for this session (TTL 5 min). */
  async markSent(sessionId: string): Promise<void> {
    try {
      await this.redis.getRedis().setex(`intervention:sent:${sessionId}`, SENT_TTL, '1');
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'LockService: markSent failed (non-fatal)');
    }
  }

  /** Returns true if an intervention was sent for this session within the last 5 minutes. */
  async isSent(sessionId: string): Promise<boolean> {
    try {
      const val = await this.redis.getRedis().get(`intervention:sent:${sessionId}`);
      return val !== null;
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'LockService: isSent check failed, assuming not sent');
      return false; // fail-open: allow the intervention attempt
    }
  }
}
