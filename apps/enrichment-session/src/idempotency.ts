import type { RedisClient } from '@org/redis_client';
import { eq, type Db } from '@org/db';
import { processedEvents } from '@org/db';
import type { EnrichmentMetrics } from './metrics.js';

export class IdempotencyService {
  constructor(
    private readonly redis: RedisClient,
    private readonly db: Db,
    private readonly bloomKey: string,
    private readonly metrics: EnrichmentMetrics,
  ) {}

  async isDuplicate(eventId: string): Promise<boolean> {
    const inBloom = await this.redis.bfExists(this.bloomKey, eventId);
    if (!inBloom) return false;

    // Possible false positive — confirm with PostgreSQL
    const rows = await this.db
      .select({ eventId: processedEvents.eventId })
      .from(processedEvents)
      .where(eq(processedEvents.eventId, eventId))
      .limit(1);

    if (rows.length === 0) {
      // Confirmed false positive
      this.metrics.bloomFalsePositive();
      return false;
    }

    return true;
  }

  async markProcessed(eventId: string): Promise<void> {
    await Promise.all([
      this.db
        .insert(processedEvents)
        .values({ eventId })
        .onConflictDoNothing(),
      this.redis.bfAdd(this.bloomKey, eventId),
    ]);
  }
}
