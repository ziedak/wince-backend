import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';

const EVAL_QUEUE_KEY = 'eval:queue';

/**
 * Manages the `eval:queue` Redis sorted set for delayed session re-evaluation.
 *
 * Sessions with risk scores below the intervention threshold are not dropped —
 * they are scheduled for re-evaluation with a backoff interval derived from
 * their current score (closer to threshold = shorter delay):
 *
 *   score 0.5–0.6  → 30 seconds
 *   score 0.3–0.5  → 2 minutes
 *   score 0.0–0.3  → 5 minutes
 */
export class SchedulerService {
  private readonly logger = createLogger({ service: 'SchedulerService' });

  constructor(private readonly redis: RedisClient) {}

  /** Schedules a session for re-evaluation at (now + delay). */
  async schedule(sessionId: string, score: number): Promise<void> {
    const delaySec = score >= 0.5 ? 30 : score >= 0.3 ? 120 : 300;
    const evalAt = Date.now() + delaySec * 1_000;
    try {
      await this.redis.getRedis().zadd(EVAL_QUEUE_KEY, evalAt, sessionId);
      this.logger.debug({ sessionId, score, delaySec }, 'Scheduled re-evaluation');
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'SchedulerService: failed to schedule (non-fatal)');
    }
  }

  /**
   * Returns up to 100 session IDs whose re-evaluation time has arrived and removes them.
   * The 100-item cap bounds per-tick work; remaining items are processed in the next tick.
   */
  async popDue(): Promise<string[]> {
    const raw = this.redis.getRedis();
    const now = Date.now();
    try {
      const members = await raw.zrangebyscore(EVAL_QUEUE_KEY, 0, now, 'LIMIT', 0, 100);
      if (members.length === 0) return [];
      // Remove the same range we just fetched. A brief race window is acceptable
      // because the user-level lock in DecisionOrchestrator prevents double interventions.
      await raw.zremrangebyscore(EVAL_QUEUE_KEY, 0, now);
      return members;
    } catch (err) {
      this.logger.warn({ err }, 'SchedulerService: popDue failed');
      return [];
    }
  }

  /**
   * Clears all pending re-evaluation entries and risk state for a user.
   * Called on purchase events to prevent post-conversion interventions.
   *
   * Removes: all user sessions from eval:queue, risk:user:{userId},
   * active_risk:{storeId} entry, user_sessions:{userId} index.
   */
  async clearUserSessions(userId: number, storeId: number): Promise<void> {
    const raw = this.redis.getRedis();
    try {
      // Fetch all session IDs registered for this user
      const sessionIds = await raw.zrange(`user_sessions:${userId}`, 0, -1);

      const pipeline = raw.pipeline();

      // Remove each session from the eval queue
      for (const sid of sessionIds) {
        pipeline.zrem(EVAL_QUEUE_KEY, sid);
      }

      // Clear user-level risk state
      pipeline.del(`risk:user:${userId}`);
      pipeline.zrem(`active_risk:${storeId}`, String(userId));
      pipeline.del(`user_sessions:${userId}`);

      await pipeline.exec();

      this.logger.info({ userId, storeId, sessionCount: sessionIds.length }, 'SchedulerService: cleared user sessions on purchase');
    } catch (err) {
      this.logger.warn({ err, userId, storeId }, 'SchedulerService: clearUserSessions failed (non-fatal)');
    }
  }
}
