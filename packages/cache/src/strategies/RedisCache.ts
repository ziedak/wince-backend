/**
 * Redis-First Authentication Cache Layer
 * Phase 1: Implement intelligent caching for authentication operations
 *
 * This service provides:
 * - Multi-level caching (L1: memory, : Redis, L3: database)
 * - Cache warming and invalidation strategies
 * - Performance monitoring and hit rate optimization
 */
import { RedisClient }from '@org/redis_client'
import { chunkArray } from "@org/utils";
import {
  type CacheConfig,
  type CacheEntry,
  type CacheHealth,
  type CacheOperationResult,
} from "../interfaces/ICache.js";
import {
  type CompressionConfig,
  DEFAULT_COMPRESSION_CONFIG,
  compress,
  decompress,
} from "../utils/CacheCompressor.js";

import { BaseCache } from "./BaseCache.js";

export interface RedisCacheConfig extends CacheConfig {
  readonly compressionThreshold: number; // bytes
  readonly batchInvalidationSize: number;
  readonly compressionConfig?: Partial<CompressionConfig>; // Compression config
}

export const DEFAULT_REDIS_CACHE_CONFIG: RedisCacheConfig = {
  enable: true,
  defaultTtl: 3600, // 1 hour
  maxTtl: 86400, // 24 hours
  minTtl: 60, // 1 minute
  compressionThreshold: 1024, // 1KB
  batchInvalidationSize: 100,
  compressionConfig: DEFAULT_COMPRESSION_CONFIG,
};

/**
 * Redis-based cache implementation
 */

export class RedisCache extends BaseCache<RedisCacheConfig> {
  constructor(
    private readonly redisClient: RedisClient,
    config?: Partial<RedisCacheConfig>
  ) {
    const fullConfig = { ...DEFAULT_REDIS_CACHE_CONFIG, ...config };
    super(fullConfig);
  }

  /**
   * Async check for both config and Redis health.
   */
  override async isEnabled(): Promise<boolean> {
    return (await super.isEnabled()) && (await this.redisClient.isHealthy());
  }
  /**
   * Cache health check
   */
  async healthCheck(): Promise<CacheHealth> {
    const result: CacheHealth = {
      status: "healthy",
      capacity: "ok",
      hitRate: this.stats.hitRate,
      entryCount: this.stats.entryCount,
    };

    try {
      await this.redisClient.ping();
    } catch (error) {
      result.status = "degraded";
    }

    return result;
  }

  /**
   * Get Redis key with namespace
   */
  private getRedisKey(key: string): string {
    return `auth:cache:${key}`;
  }

  /**
   * Get from Redis cache
   */
  private async getFromRedis<T>(key: string): Promise<CacheEntry<T> | null> {
    const redisKey = this.getRedisKey(key);

    const rawData = await this.redisClient.safeGet(redisKey);

    if (!rawData) return null;

    try {
      const entry: CacheEntry<T> = JSON.parse(rawData);

      // Decompress data if it was compressed
      if (entry.compressed && entry.compressionAlgorithm) {
        try {
          const decompressResult = await decompress(
            entry.data,
            DEFAULT_COMPRESSION_CONFIG
          );
          entry.data = decompressResult.data as T;
          entry.compressed = false; // Mark as decompressed
        } catch (error) {
          this.logger.warn({ message: "Failed to decompress Redis cache entry", key, algorithm: entry.compressionAlgorithm, error: error instanceof Error ? error.message : String(error) });
          // Return raw data as fallback
        }
      }

      return entry;
    } catch (error) {
      this.logger.error({ message: `Redis cache deserialization error for key: ${key}`, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      // RedisClient.safeDel already has retry logic built-in
      await this.redisClient.safeDel(redisKey);
      return null;
    }
  }

  /**
   * Set in Redis cache with optional compression
   */
  private async setInRedis<T>(
    key: string,
    data: T,
    ttl: number
  ): Promise<void> {
    // Compress data if enabled and meets threshold
    let finalData: T | unknown = data;
    let compressed = false;
    let compressionAlgorithm: string | undefined;

    if (this.config.compressionConfig?.enableCompression) {
      try {
        const compressionResult = await compress(
          data,
          DEFAULT_COMPRESSION_CONFIG
        );
        if (compressionResult.compressed) {
          finalData = compressionResult.data;
          compressed = true;
          compressionAlgorithm = compressionResult.algorithm;
          this.stats.compressions++;
        }
      } catch (error) {
        this.logger.warn({ message: "Redis compression failed, storing uncompressed data", key, error: error instanceof Error ? error.message : String(error) });
      
      }
    }

    const entry: CacheEntry<T> = {
      data: finalData as T,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      compressed,
      ...(compressionAlgorithm && { compressionAlgorithm }),
    };

    const serializedData = JSON.stringify(entry);
    const redisKey = this.getRedisKey(key);

    await this.redisClient.safeSetEx(redisKey, ttl, serializedData);
  }

  // Abstract method implementations
  protected async doGet<T>(
    key: string
  ): Promise<CacheOperationResult<T> | null> {
    const entry = await this.getFromRedis<T>(key);
    if (entry) {
      return {
        data: entry.data,
        source: "l2",
        latency: 0, // Will be set by base class
        compressed: entry.compressed,
      };
    }
    return null;
  }

  protected async doSet<T>(key: string, data: T, ttl: number): Promise<void> {
    await this.setInRedis(key, data, ttl);
  }

  protected async doInvalidate(key: string): Promise<void> {
    await this.redisClient.safeDel(this.getRedisKey(key));
  }

  protected async doInvalidatePattern(pattern: string): Promise<number> {
    let invalidatedCount = 0;
    const redisPattern = this.getRedisKey(pattern);
    const keys = await this.redisClient.safeKeys(redisPattern);

    if (keys.length > 0) {
      const batches = chunkArray(keys, this.config.batchInvalidationSize);

      for (const batch of batches) {
        await this.redisClient.safeDel(...batch);
        invalidatedCount += batch.length;
      }
    }

    return invalidatedCount;
  }

  protected async doExists(key: string): Promise<boolean> {
    const redisKey = this.getRedisKey(key);
    const exists = await this.redisClient.exists(redisKey);
    return exists > 0;
  }

  protected async doIncrement(key: string, delta: number): Promise<number> {
    const redisKey = this.getRedisKey(key);
    const redis = this.redisClient.getRedis();

    if (delta === 1) {
      // Use INCR for simple increment
      return redis.incr(redisKey);
    }

    // Use INCRBY for custom delta
    return redis.incrby(redisKey, delta);
  }

  protected async doExpire(key: string, ttl: number): Promise<boolean> {
    const redisKey = this.getRedisKey(key);
    const redis = this.redisClient.getRedis();
    const result = await redis.expire(redisKey, ttl);
    return result === 1;
  }

  protected async doGetTTL(key: string): Promise<number> {
    const redisKey = this.getRedisKey(key);
    const redis = this.redisClient.getRedis();
    return redis.ttl(redisKey);
  }

  protected async doMGet<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) {
      return [];
    }

    const redisKeys = keys.map((k) => this.getRedisKey(k));
    const rawResults = await this.redisClient.safeMget(...redisKeys);

    const results: (T | null)[] = [];

    for (const rawData of rawResults) {
      if (!rawData) {
        results.push(null);
        continue;
      }

      try {
        const entry: CacheEntry<T> = JSON.parse(rawData);

        // Decompress data if it was compressed
        let { data } = entry;
        if (entry.compressed && entry.compressionAlgorithm) {
          try {
            const decompressResult = await decompress(
              data,
              DEFAULT_COMPRESSION_CONFIG
            );
            data = decompressResult.data as T;
          } catch (error) {
            this.logger.warn({ message: "Failed to decompress Redis cache entry in mGet", key: entry.data, algorithm: entry.compressionAlgorithm, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
            // Use raw data as fallback
          }
        }

        results.push(data);
      } catch (error) {
        this.logger.error(
          { message: "Redis cache deserialization error in mGet", error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }
        );
        results.push(null);
      }
    }

    return results;
  }

  protected async doMSet<T>(
    entries: Record<string, T>,
    ttl: number
  ): Promise<void> {
    const redis = this.redisClient.getRedis();
    const pipeline = redis.pipeline();

    for (const [key, data] of Object.entries(entries)) {
      // Compress data if enabled and meets threshold
      let finalData: T | unknown = data;
      let compressed = false;
      let compressionAlgorithm: string | undefined;

      if (this.config.compressionConfig?.enableCompression) {
        try {
          const compressionResult = await compress(
            data,
            DEFAULT_COMPRESSION_CONFIG
          );
          if (compressionResult.compressed) {
            finalData = compressionResult.data;
            compressed = true;
            compressionAlgorithm = compressionResult.algorithm;
            this.stats.compressions++;
          }
        } catch (error) {
          this.logger.warn({ message: "Redis compression failed in mSet, storing uncompressed data", key, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
        }
      }

      const entry: CacheEntry<T> = {
        data: finalData as T,
        timestamp: Date.now(),
        ttl,
        hits: 0,
        compressed,
        ...(compressionAlgorithm && { compressionAlgorithm }),
      };

      const serializedData = JSON.stringify(entry);
      const redisKey = this.getRedisKey(key);

      pipeline.setex(redisKey, ttl, serializedData);
    }

    await pipeline.exec();
  }

  protected async doMInvalidate(tags: string[]): Promise<void> {
    // For Redis cache, treat tags as key patterns
    for (const tag of tags) {
      await this.doInvalidatePattern(`*${tag}*`);
    }
  }

  /**
   * Dispose of Redis cache resources
   */
  async dispose(): Promise<void> {
    try {
      await this.redisClient.disconnect();
      this.logger.info({ message: "RedisCache disposed successfully" });
    } catch (error) {
      this.logger.error({ message: "Error during RedisCache disposal", error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
    }
  }
}
