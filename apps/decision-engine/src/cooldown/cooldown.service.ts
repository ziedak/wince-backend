import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';

export class CooldownService {
  private readonly logger = createLogger({ service: 'CooldownService' });

  constructor(private readonly redisClient: RedisClient) {}

  /**
   * Returns true when a cooldown is still active for the given (store, distinct_id) pair.
   * Uses plain GET — does NOT renew the TTL on check (correct semantics).
   */
  async isOnCooldown(storeId: number, distinctId: string): Promise<boolean> {
    try {
      const redis = this.redisClient.getRedis();
      const result = await redis.get(`cooldown:${storeId}:${distinctId}`);
      return result !== null;
    } catch (err) {
      this.logger.warn({ err, storeId, distinctId }, 'CooldownService: check failed, failing open');
      return false; // fail-open: allow intervention on Redis error
    }
  }

  /**
   * Activates a cooldown for the given (store, distinct_id) pair.
   * Uses SETEX for a precise TTL matching the policy window.
   */
  async setCooldown(storeId: number, distinctId: string, ttlSeconds: number): Promise<void> {
    try {
      const redis = this.redisClient.getRedis();
      await redis.setex(`cooldown:${storeId}:${distinctId}`, ttlSeconds, '1');
    } catch (err) {
      this.logger.warn({ err, storeId, distinctId }, 'CooldownService: failed to set cooldown');
    }
  }

  async clearCooldown(storeId: number, distinctId: string): Promise<void> {
    try {
      const redis = this.redisClient.getRedis();
      await redis.del(`cooldown:${storeId}:${distinctId}`);
    } catch (err) {
      this.logger.warn({ err, storeId, distinctId }, 'CooldownService: failed to clear cooldown');
    }
  }
}
