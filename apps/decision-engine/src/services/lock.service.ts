import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';
import { randomUUID } from 'node:crypto';
import type { DecisionMetrics } from '../metrics.js';

const USER_LOCK_TTL = 30;  // seconds — covers full Phase 2 pipeline execution
const SENT_TTL = 600;      // 10 minutes — user-scoped sent marker (v2 spec §4.2)

// Atomic acquire: SET NX EX; returns token on success, '' on contention
const ACQUIRE_SCRIPT = `
if redis.call('set', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2]) then
  return ARGV[1]
else
  return ''
end
`.trim();

// Atomic renew: extend TTL only if the caller still holds the lock (fencing check)
const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('expire', KEYS[1], ARGV[2])
  return 1
else
  return 0
end
`.trim();

// Atomic release: delete only if the caller still holds the lock
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`.trim();

/**
 * User-scoped intervention lock with fencing tokens.
 *
 * All five decision entry points (Kafka consumer, HTTP trigger, scheduler,
 * stale scanner, admin manual intervention) acquire lock:user:{userId} before
 * entering Phase 2. This prevents two concurrent events from different sessions
 * of the same user from producing duplicate interventions.
 *
 * Phase 1 (risk scoring) runs WITHOUT this lock — its Redis writes are
 * last-write-wins idempotent. Concurrent re-scoring is wasteful but correct.
 *
 * Fencing token: a random UUID stored as the lock value. Callers verify the
 * token on each renewal. A stale holder that resumes after a GC pause past
 * its TTL will observe renewUserLock() = false and must abort Phase 2.
 */
export class LockService {
  private readonly logger = createLogger({ service: 'LockService' });

  constructor(
    private readonly redis: RedisClient,
    private readonly metrics: DecisionMetrics,
  ) {}

  /**
   * Attempts to acquire the user-level intervention lock.
   *
   * Returns a fencing token (UUID) on success. Returns null when the lock is
   * already held. Fails open (returns a token) on Redis errors to avoid
   * blocking interventions during Redis degradation.
   */
  async acquireUserLock(userId: number): Promise<string | null> {
    const key = `lock:user:${userId}`;
    const token = randomUUID();
    try {
      const result = (await this.redis.getRedis().eval(
        ACQUIRE_SCRIPT, 1, key, token, String(USER_LOCK_TTL),
      )) as string;
      return result === token ? token : null;
    } catch (err) {
      this.logger.warn({ err, userId }, 'LockService: acquireUserLock error, failing open');
      this.metrics.lockAcquireFailed('user');
      return token; // fail-open
    }
  }

  /**
   * Renews the lock TTL only if the caller still owns it (fencing check).
   * Returns false when the lock was lost — callers must abort Phase 2 immediately.
   */
  async renewUserLock(userId: number, token: string): Promise<boolean> {
    const key = `lock:user:${userId}`;
    try {
      const result = await this.redis.getRedis().eval(
        RENEW_SCRIPT, 1, key, token, String(USER_LOCK_TTL),
      );
      return result === 1;
    } catch (err) {
      this.logger.warn({ err, userId }, 'LockService: renewUserLock failed, assuming still valid');
      return true; // assume valid on transient Redis error
    }
  }

  /**
   * Releases the lock. No-op if the lock was already released or taken by another holder.
   * Must be called in finally blocks after Phase 2 completes or fails terminally.
   */
  async releaseUserLock(userId: number, token: string): Promise<void> {
    const key = `lock:user:${userId}`;
    try {
      await this.redis.getRedis().eval(RELEASE_SCRIPT, 1, key, token);
    } catch (err) {
      this.logger.warn({ err, userId }, 'LockService: releaseUserLock failed — will expire via TTL');
    }
  }

  /**
   * Returns true if an intervention was already sent to this user within the last
   * 10 minutes. Checked before lock acquisition as a cheap fast-path guard.
   */
  async isSent(userId: number): Promise<boolean> {
    try {
      const val = await this.redis.getRedis().get(`sent:user:${userId}`);
      return val !== null;
    } catch (err) {
      this.logger.warn({ err, userId }, 'LockService: isSent check failed, assuming not sent (fail-open)');
      return false;
    }
  }

  /**
   * Records that an intervention was successfully delivered to this user.
   * TTL = 10 minutes. Prevents duplicates from any entry point during an
   * active intervention episode.
   */
  async markSent(userId: number): Promise<void> {
    try {
      await this.redis.getRedis().setex(`sent:user:${userId}`, SENT_TTL, '1');
    } catch (err) {
      this.logger.warn({ err, userId }, 'LockService: markSent failed (non-fatal)');
    }
  }

  /**
   * Clears the sent marker for a user. Called on purchase events so the next
   * shopping session (repeat buyer) can trigger fresh interventions.
   */
  async clearUserSent(userId: number): Promise<void> {
    try {
      await this.redis.getRedis().del(`sent:user:${userId}`);
    } catch (err) {
      this.logger.warn({ err, userId }, 'LockService: clearUserSent failed (non-fatal)');
    }
  }
}
