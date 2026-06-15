// libs/cache/src/strategies/BaseCache.ts
import { createLogger } from "@org/logger";
import {
  DEFAULT_CACHE_STATS,
  type CacheConfig,
  type CacheHealth,
  type CacheOperationResult,
  type CacheStats,
  type ICache,
} from "../interfaces/ICache.js";

export abstract class BaseCache<TConfig extends CacheConfig = CacheConfig>
  implements ICache
{
  protected readonly config: TConfig;
  protected stats: CacheStats = { ...DEFAULT_CACHE_STATS };
  protected logger = createLogger({ service: this.constructor.name });

  constructor(config: Partial<TConfig> = {}) {
    this.config = { enable: true, defaultTtl: 3600, ...config } as TConfig;
  }

  // Common implementations
  async isEnabled(): Promise<boolean> {
    return Promise.resolve(this.config.enable);
  }
  getStats(): CacheStats {
    return { ...this.stats };
  }

  async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();
    this.stats.totalRequests++;
    if (!this.isEnabled())
      return {
        data: null,
        source: "miss",
        latency: performance.now() - startTime,
        compressed: false,
      };

    try {
      const result = await this.doGet<T>(key);
      if (result) {
        this.stats.Hits++;
        return { ...result, latency: performance.now() - startTime };
      }
      this.stats.Misses++;
    } catch (error) {
      this.logger.error({ message: `Get error for key: ${key}`, error: error as Error } );
    }
    return {
      data: null,
      source: "miss",
      latency: performance.now() - startTime,
      compressed: false,
    };
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.doSet(key, data, ttl ?? this.config.defaultTtl);
    } catch (error) {
      this.logger.error({ message: `Set error for key: ${key}`, error: error as Error });
    }
  }

  async invalidate(key: string): Promise<void> {
    this.stats.invalidations++;
    if (!this.isEnabled()) return;
    try {
      await this.doInvalidate(key);
    } catch (error) {
      this.logger.error({ message: `Invalidate error for key: ${key}`, error: error as Error });
    }
  }

  async invalidatePattern(pattern: string): Promise<number> {
    if (!this.isEnabled()) return 0;
    try {
      return await this.doInvalidatePattern(pattern);
    } catch (error) {
      this.logger.error({ message: `Invalidate pattern error for: ${pattern}`, error: error as Error });  
      return 0;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      return await this.doExists(key);
    } catch (error) {
      this.logger.error({ message: `Exists error for key: ${key}`, error: error as Error });
      return false;
    }
  }

  async increment(key: string, delta: number = 1): Promise<number> {
    if (!this.isEnabled()) return 0;
    try {
      return await this.doIncrement(key, delta);
    } catch (error) {
      this.logger.error({ message: `Increment error for key: ${key}`, error: error as Error });
      return 0;
    }
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      return await this.doExpire(key, ttl);
    } catch (error) {
      this.logger.error({ message: `Expire error for key: ${key}`, error: error as Error });
      return false;
    }
  }

  async getTTL(key: string): Promise<number> {
    if (!this.isEnabled()) return -2;
    try {
      return await this.doGetTTL(key);
    } catch (error) {
      this.logger.error({ message: `GetTTL error for key: ${key}`, error: error as Error });
      return -2;
    }
  }

  async mGet<T>(keys: string[]): Promise<(T | null)[]> {
    if (!this.isEnabled()) return keys.map(() => null);
    try {
      return await this.doMGet<T>(keys);
    } catch (error) {
      this.logger.error({ message: `MGet error for keys`, error: error as Error });
      return keys.map(() => null);
    }
  }

  async mSet<T>(entries: Record<string, T>, ttl?: number): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.doMSet(entries, ttl ?? this.config.defaultTtl);
    } catch (error) {
      this.logger.error({ message: `MSet error`, error: error as Error });
    }
  }

  async getOrCompute<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Try to get from cache first
    const result = await this.get<T>(key);
    if (result.data !== null) {
      return result.data;
    }

    // Not in cache, compute the value
    try {
      const computedValue = await computeFn();

      // Store in cache
      await this.set(key, computedValue, ttl ?? this.config.defaultTtl);

      return computedValue;
    } catch (error) {
      this.logger.error({ message: `GetOrCompute error for key: ${key}`, error: error as Error });
      throw error;
    }
  }

  async mInvalidate(tags: string[]): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.doMInvalidate(tags);
    } catch (error) {
      this.logger.error({ message: `MInvalidate error for tags`, error: error as Error });
    }
  }

  // Abstract methods for subclasses
  protected abstract doGet<T>(
    key: string
  ): Promise<CacheOperationResult<T> | null>;
  protected abstract doSet<T>(key: string, data: T, ttl: number): Promise<void>;
  protected abstract doInvalidate(key: string): Promise<void>;
  protected abstract doInvalidatePattern(pattern: string): Promise<number>;
  protected abstract doExists(key: string): Promise<boolean>;
  protected abstract doIncrement(key: string, delta: number): Promise<number>;
  protected abstract doExpire(key: string, ttl: number): Promise<boolean>;
  protected abstract doGetTTL(key: string): Promise<number>;
  protected abstract doMGet<T>(keys: string[]): Promise<(T | null)[]>;
  protected abstract doMSet<T>(
    entries: Record<string, T>,
    ttl: number
  ): Promise<void>;
  protected abstract doMInvalidate(tags: string[]): Promise<void>;
  abstract healthCheck(): Promise<CacheHealth>;
}
