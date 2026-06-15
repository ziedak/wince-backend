/**
 * Cache Warming Strategies
 * Provides intelligent cache warming for frequently accessed data
 */

import { createLogger } from '@org/logger';
import type {
  ICache,
  CacheWarmingStrategy,
  CacheWarmingResult,
  WarmupDataProvider,
} from '../../interfaces/ICache.js';

/**
 * Base class for cache warming strategies
 */
export abstract class BaseCacheWarmingStrategy implements CacheWarmingStrategy {
  abstract readonly name: string;
  protected readonly logger = createLogger(
    {service: `CacheWarming-${this.constructor.name}`},
  );

  abstract warmup(
    cache: ICache,
    provider: WarmupDataProvider,
  ): Promise<CacheWarmingResult>;

  abstract getRecommendedKeys(): string[];

  /**
   * Execute warmup with error handling and metrics
   */
  protected async executeWarmup(
    cache: ICache,
    provider: WarmupDataProvider,
    keys: string[],
  ): Promise<CacheWarmingResult> {
    const startTime = performance.now();
    let keysProcessed = 0;
    let keysFailed = 0;
    const errors: string[] = [];

    this.logger.info({ message: 'Starting cache warmup', strategy: this.name, keysCount: keys.length });

    // Process keys in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);

      const batchPromises = batch.map(async (key) => {
        try {
          const data = await provider.loadDataForKey(key);
          if (data !== null) {
            await cache.set(key, data);
            keysProcessed++;
          }
        } catch (error) {
          keysFailed++;
          errors.push(
            `${key}: ${error instanceof Error ? error.message : String(error)}`,
          );
          this.logger.warn({ message: `Failed to warmup key: ${key}`, error });
        }
      });

      await Promise.all(batchPromises);
    }

    const duration = performance.now() - startTime;

    this.logger.info({
      message: 'Cache warmup completed',
      strategy: this.name,
      keysProcessed,
      keysFailed,
      duration: Math.round(duration),
      successRate: keys.length > 0 ? (keysProcessed / keys.length) * 100 : 0,
    });

    return {
      success: keysFailed === 0,
      keysProcessed,
      keysFailed,
      duration,
      errors,
    };
  }
}
