import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';

export class CooldownService {
  private readonly logger = createLogger({ service: 'CooldownService' });

  constructor(private readonly redisClient: RedisClient) {}

  /**
   * Returns true when a cooldown is still active for the given (store, customer) pair.
   * Uses customerId (integer) so all devices for the same customer share a cooldown.
   * Uses plain GET — does NOT renew the TTL on check (correct semantics).
   */
  async isOnCooldown(storeId: number, customerId: number): Promise<boolean> {
    try {
      const redis = this.redisClient.getRedis();
      const result = await redis.get(`cooldown:${storeId}:${customerId}`);
      return result !== null;
    } catch (err) {
      this.logger.warn({ err, storeId, customerId }, 'CooldownService: check failed, failing open');
      return false; // fail-open: allow intervention on Redis error
    }
  }

  /**
   * Activates a cooldown for the given (store, customer) pair.
   * Uses SETEX for a precise TTL matching the policy window.
   */
  async setCooldown(storeId: number, customerId: number, ttlSeconds: number): Promise<void> {
    try {
      const redis = this.redisClient.getRedis();
      await redis.setex(`cooldown:${storeId}:${customerId}`, ttlSeconds, '1');
    } catch (err) {
      this.logger.warn({ err, storeId, customerId }, 'CooldownService: failed to set cooldown');
    }
  }

  async clearCooldown(storeId: number, customerId: number): Promise<void> {
    try {
      const redis = this.redisClient.getRedis();
      await redis.del(`cooldown:${storeId}:${customerId}`);
    } catch (err) {
      this.logger.warn({ err, storeId, customerId }, 'CooldownService: failed to clear cooldown');
    }
  }
}
