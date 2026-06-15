/**
 * Redis-First Authentication Cache Layer
 * Phase 1: Implement intelligent caching for authentication operations
 *
 * This service provides:
 * - Multi-level caching (L1: memory, L2: Redis, L3: database)
 * - Cache warming strategies
 * - Intelligent invalidation strategies
 * - Performance monitoring and hit rate optimization
 * - Memory management and compression support
 */

import { createLogger } from "@org/logger";
import type {
  ICache,
  CacheConfig,
  CacheOperationResult,
  CacheStats,
  CacheHealth,
  CacheWarmingResult,
  WarmupDataProvider,
} from "./interfaces/ICache.js";
import { CacheWarmingManager } from "./warming/CacheWarmingManager.js";
import { AuthDataProvider } from "./warming/AuthDataProvider.js";
import { MemoryCache } from "./strategies/MemoryCache.js";
import { RedisCache } from "./strategies/RedisCache.js";
import { RedisClient }from '@org/redis_client'
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enable: true,
  defaultTtl: 300, // 5 minutes
  minTtl: 60, // 1 minute
  maxTtl: 3600, // 1 hour
  warmupOnStart: false,
  warmingConfig: {
    enableBackgroundWarming: false,
    backgroundWarmingInterval: 300,
    adaptiveWarming: true,
    maxWarmupKeys: 100,
    warmupBatchSize: 10,
    enablePatternLearning: true,
  },
};

/**
 * High-performance caching service
 */
export class CacheService implements ICache {
  private readonly config: CacheConfig;
  private readonly caches: ICache[];
  private readonly warmingManager: CacheWarmingManager;
  private readonly dataProvider: WarmupDataProvider;
  private readonly stats: CacheStats = {
    Hits: 0,
    Misses: 0,
    totalRequests: 0,
    hitRate: 0,
    memoryUsage: 0,
    entryCount: 0,
    invalidations: 0,
    compressions: 0,
  };
  protected readonly logger = createLogger({ service: "CacheService" });
  constructor(
    redisClient?: RedisClient,
    caches?: ICache[],
    config: Partial<CacheConfig> = {}
  ) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.caches = caches ?? [
      new MemoryCache(),
      ...(redisClient ? [new RedisCache(redisClient)] : []),
    ];

    // Initialize warming components
    this.dataProvider = new AuthDataProvider();
    this.warmingManager = new CacheWarmingManager(this.config.warmingConfig);

    if (this.config.warmupOnStart) {
      this.warmupCache().catch((error) => {
        this.logger.error({ message: "Cache warmup failed during initialization", error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      });
    }

    // Start background warming if enabled
    if (this.config.warmingConfig?.enableBackgroundWarming) {
      this.startBackgroundWarming();
    }
  }

  /**
   * General factory method - creates a cache service with custom configuration
   * @param metrics - Optional metrics collector for monitoring
   * @param caches - Optional custom cache implementations
   * @param config - Partial cache configuration
   * @returns CacheService instance
   */
  static create(
    redisClient?: RedisClient,
    caches?: ICache[],
    config: Partial<CacheConfig> = {}
  ): CacheService {
    return new CacheService(redisClient, caches, config);
  }

  /**
   * Factory: Memory-only cache (no Redis)
   * Ideal for: Testing, single-instance apps, or when Redis is unavailable
   * @param config - Optional cache configuration
   * @returns CacheService with only memory cache
   */
  static createMemoryOnly(config: Partial<CacheConfig> = {}): CacheService {
    const memoryCache = new MemoryCache({
      enable: true,
      defaultTtl: config.defaultTtl ?? 300,
      maxTtl: config.maxTtl ?? 3600,
      minTtl: config.minTtl ?? 60,
      maxMemoryCacheSize: 10000, // 10k entries
    });

    return new CacheService(undefined, [memoryCache], config);
  }

  /**
   * Factory: Redis-only cache (no memory layer)
   * Ideal for: Multi-instance deployments, shared cache requirements
   * @param metrics - Metrics collector for monitoring
   * @param config - Optional cache configuration
   * @returns CacheService with only Redis cache
   */
  static createRedisOnly(
    redisClient: RedisClient,
    config: Partial<CacheConfig> = {}
  ): CacheService {
    const redisCache = new RedisCache(redisClient, {
      enable: true,
      defaultTtl: config.defaultTtl ?? 300,
      maxTtl: config.maxTtl ?? 3600,
      minTtl: config.minTtl ?? 60,
    });

    return new CacheService(redisClient, [redisCache], config);
  }

  /**
   * Factory: Multi-level cache (Memory + Redis)
   * Ideal for: Production deployments with high performance requirements
   * @param metrics - Metrics collector for monitoring
   * @param config - Optional cache configuration
   * @returns CacheService with memory and Redis cache levels
   */
  static createMultiLevel(
    redisClient: RedisClient,
    config: Partial<CacheConfig> = {}
  ): CacheService {
    const memoryCache = new MemoryCache({
      enable: true,
      defaultTtl: config.defaultTtl ?? 300,
      maxTtl: config.maxTtl ?? 3600,
      minTtl: config.minTtl ?? 60,
      maxMemoryCacheSize: 10000,
    });

    const redisCache = new RedisCache(redisClient, {
      enable: true,
      defaultTtl: config.defaultTtl ?? 300,
      maxTtl: config.maxTtl ?? 3600,
      minTtl: config.minTtl ?? 60,
    });

    return new CacheService(redisClient, [memoryCache, redisCache], config);
  }

  /**
   * Factory: Development mode cache with warmup
   * Ideal for: Development environment with pre-populated cache
   * @param metrics - Optional metrics collector
   * @param config - Optional cache configuration
   * @returns CacheService with warmup enabled
   */
  static createForDevelopment(
    redisClient?: RedisClient,
    config: Partial<CacheConfig> = {}
  ): CacheService {
    const devConfig: Partial<CacheConfig> = {
      ...config,
      enable: true,
      warmupOnStart: true,
      warmingConfig: {
        enableBackgroundWarming: true,
        backgroundWarmingInterval: 600, // 10 minutes
        adaptiveWarming: true,
        maxWarmupKeys: 50, // Lower for dev
        warmupBatchSize: 10,
        enablePatternLearning: true,
      },
    };

    return new CacheService(redisClient, undefined, devConfig);
  }

  /**
   * Factory: Production mode cache with optimizations
   * Ideal for: Production environment with full monitoring
   * @param metrics - Metrics collector (required for production)
   * @param config - Optional cache configuration
   * @returns CacheService optimized for production
   */
  static createForProduction(
    redisClient:  RedisClient,
    config: Partial<CacheConfig> = {}
  ): CacheService {
    const prodConfig: Partial<CacheConfig> = {
      ...config,
      enable: true,
      defaultTtl: config.defaultTtl ?? 600, // 10 minutes
      maxTtl: config.maxTtl ?? 7200, // 2 hours
      minTtl: config.minTtl ?? 60, // 1 minute
      warmupOnStart: false, // Don't block startup
      warmingConfig: {
        enableBackgroundWarming: true,
        backgroundWarmingInterval: 300, // 5 minutes
        adaptiveWarming: true,
        maxWarmupKeys: 1000, // Higher for production
        warmupBatchSize: 50,
        enablePatternLearning: true,
      },
    };

    return CacheService.createMultiLevel(redisClient, prodConfig);
  }

  /**
   * Factory: Testing mode cache
   * Ideal for: Unit tests and integration tests
   * @param config - Optional cache configuration
   * @returns CacheService optimized for testing (memory-only, no warmup)
   */
  static createForTesting(config: Partial<CacheConfig> = {}): CacheService {
    const testConfig: Partial<CacheConfig> = {
      ...config,
      enable: true,
      defaultTtl: 300,
      maxTtl: 600,
      minTtl: 60,
      warmupOnStart: false,
      warmingConfig: {
        enableBackgroundWarming: false,
        adaptiveWarming: false,
      },
    };

    return CacheService.createMemoryOnly(testConfig);
  }

  /**
   * Factory: High-throughput cache configuration
   * Ideal for: High-traffic applications with aggressive caching
   * @param metrics - Metrics collector for monitoring
   * @param config - Optional cache configuration
   * @returns CacheService optimized for high throughput
   */
  static createHighThroughput(
    redisClient: RedisClient,
    config: Partial<CacheConfig> = {}
  ): CacheService {
    const highThroughputConfig: Partial<CacheConfig> = {
      ...config,
      enable: true,
      defaultTtl: config.defaultTtl ?? 1800, // 30 minutes
      maxTtl: config.maxTtl ?? 14400, // 4 hours
      minTtl: config.minTtl ?? 300, // 5 minutes
      warmupOnStart: true,
      warmingConfig: {
        enableBackgroundWarming: true,
        backgroundWarmingInterval: 180, // 3 minutes
        adaptiveWarming: true,
        maxWarmupKeys: 2000,
        warmupBatchSize: 100,
        enablePatternLearning: true,
      },
    };

    // Create cache with larger memory buffer
    const memoryCache = new MemoryCache({
      enable: true,
      defaultTtl: highThroughputConfig.defaultTtl ?? 1800,
      maxTtl: highThroughputConfig.maxTtl ?? 14400,
      minTtl: highThroughputConfig.minTtl ?? 300,
      maxMemoryCacheSize: 50000, // 50k entries for high throughput
    });

    const redisCache = new RedisCache(redisClient, {
      enable: true,
      defaultTtl: highThroughputConfig.defaultTtl ?? 1800,
      maxTtl: highThroughputConfig.maxTtl ?? 14400,
      minTtl: highThroughputConfig.minTtl ?? 300,
    });

    return new CacheService(
      redisClient,
      [memoryCache, redisCache],
      highThroughputConfig
    );
  }

  /**
   * Factory: Custom cache with specific strategies
   * Ideal for: Custom cache implementations or specific use cases
   * @param caches - Array of custom cache implementations
   * @param metrics - Optional metrics collector
   * @param config - Optional cache configuration
   * @returns CacheService with custom cache strategies
   */
  static createWithCustomCaches(
    caches: ICache[],
    redisClient?: RedisClient,
    config: Partial<CacheConfig> = {}
  ): CacheService {
    if (!caches.length) {
      throw new Error("At least one cache implementation must be provided");
    }

    return new CacheService(redisClient, caches, config);
  }

  protected isValidKey(key: string): boolean {
    if (!key || typeof key !== "string") {
      this.logger.warn({ key }, "Invalid cache key provided to invalidate");
      return false;
    }

    if (key.length > 512) {
      this.logger.warn({ keyLength: key.length }, "Cache key too long for invalidation");
      return false;
    }
    return true;
  }
  /**
   * Get data from cache with multi-level fallback and input validation
   */
  async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();
    this.stats.totalRequests++;

    // Input validation
    if (!this.isValidKey(key)) {
      this.logger.warn({ key }, "Invalid cache key provided to get");
      return {
        data: null,
        source: "miss",
        latency: performance.now() - startTime,
        compressed: false,
      };
    }

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        const result = await cache.get<T>(key);
        if (result?.data !== null) {
          this.updateHitRate();

          // Record access pattern for adaptive learning
          if (this.config.warmingConfig?.enablePatternLearning) {
            this.warmingManager.recordAccess(key, result.latency);
          }
          // TODO add logic to promote frequently accessed keys to higher cache levels
          return {
            data: result.data,
            source: `l${idx + 1}`,
            latency: performance.now() - startTime,
            compressed: result.compressed,
          };
        }
      } catch (error) {
        this.logger.error({ key, error: error instanceof Error ? error.message : String(error) }, `Cache get failed for level ${idx + 1}`);
        // Continue to next cache level on error
      }
    }

    this.updateHitRate();

    return {
      data: null,
      source: "miss",
      latency: performance.now() - startTime,
      compressed: false,
    };
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isValidKey(key)) {
      return false;
    }

    // Check across all cache levels
    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        const exists = await cache.exists(key);
        if (exists) {
          return true;
        }
      } catch (error) {
        this.logger.error({ key, error: error instanceof Error ? error.message : String(error) }, `Cache exists check failed for level ${idx + 1}`);
        // Continue to next cache level on error
      }
    }

    return false;
  }

  /**
   * Atomically increment a counter across all cache levels
   */
  async increment(key: string, delta: number = 1): Promise<number> {
    if (!this.isValidKey(key)) {
      return 0;
    }

    let finalValue = 0;

    // Increment across all cache levels to keep them in sync
    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        const value = await cache.increment(key, delta);
        // Use the value from the first successful cache level
        if (idx === 0) {
          finalValue = value;
        }
      } catch (error) {
        this.logger.error({ key, delta, error: error instanceof Error ? error.message : String(error) }, `Cache increment failed for level ${idx + 1}`);
        // Continue to next cache level even if one fails
      }
    }

    return finalValue;
  }

  /**
   * Set or update TTL for a key across all cache levels
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    if (!this.isValidKey(key)) {
      return false;
    }

    // Enforce TTL boundaries
    const effectiveTtl = Math.max(
      this.config.minTtl,
      Math.min(ttl, this.config.maxTtl)
    );

    let success = false;

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        const result = await cache.expire(key, effectiveTtl);
        if (result) {
          success = true;
        }
      } catch (error) {
        this.logger.error({ key, ttl: effectiveTtl, error: error instanceof Error ? error.message : String(error) }, `Cache expire failed for level ${idx + 1}`);
        // Continue to next cache level even if one fails
      }
    }

    return success;
  }

  /**
   * Get remaining TTL for a key (checks first available cache level)
   */
  async getTTL(key: string): Promise<number> {
    if (!this.isValidKey(key)) {
      return -2;
    }

    // Check across cache levels, return from first available
    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        const ttl = await cache.getTTL(key);
        // Return if we find the key (ttl >= -1)
        if (ttl !== -2) {
          return ttl;
        }
      } catch (error) {
        this.logger.error({ key, error: error instanceof Error ? error.message : String(error) }, `Cache getTTL failed for level ${idx + 1}`);
        // Continue to next cache level on error
      }
    }

    return -2; // Key not found in any cache level
  }

  /**
   * Batch get multiple keys with multi-level fallback
   */
  async mGet<T>(keys: string[]): Promise<(T | null)[]> {
    if (!keys.length) {
      return [];
    }

    // Validate all keys
    const validKeys = keys.filter((key) => this.isValidKey(key));
    if (validKeys.length !== keys.length) {
      this.logger.warn({ totalKeys: keys.length, validKeys: validKeys.length }, "Some invalid keys filtered out in mGet");
    }

    // Initialize results array with nulls
    const results: (T | null)[] = new Array(validKeys.length).fill(null);
    const missingIndices: number[] = validKeys.map((_, idx) => idx);

    // Try each cache level
    for (
      let cacheIdx = 0;
      cacheIdx < this.caches.length && missingIndices.length > 0;
      cacheIdx++
    ) {
      const cache = this.caches[cacheIdx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        // Get only missing keys
        const keysToFetch = missingIndices
          .map((idx) => validKeys[idx])
          .filter((k): k is string => k !== undefined);
        const cacheResults = await cache.mGet<T>(keysToFetch);

        // Update results and track which keys are still missing
        const stillMissing: number[] = [];
        for (let i = 0; i < cacheResults.length; i++) {
          const resultIdx = missingIndices[i];
          const cacheResult = cacheResults[i];
          if (resultIdx !== undefined && cacheResult != null) {
            results[resultIdx] = cacheResult;
            this.stats.Hits++;
          } else if (resultIdx !== undefined) {
            stillMissing.push(resultIdx);
          }
        }

        missingIndices.length = 0;
        missingIndices.push(...stillMissing);
      } catch (error) {
        this.logger.error({ keyCount: missingIndices.length, error: error instanceof Error ? error.message : String(error) }, `Cache mGet failed for level ${cacheIdx + 1}`);
        // Continue to next cache level on error
      }
    }

    // Update stats
    this.stats.Misses += missingIndices.length;
    this.stats.totalRequests += validKeys.length;
    this.updateHitRate();

    return results;
  }

  /**
   * Batch set multiple keys across all cache levels
   */
  async mSet<T>(entries: Record<string, T>, ttl?: number): Promise<void> {
    const entriesArray = Object.entries(entries);
    if (!entriesArray.length) {
      return;
    }

    // Validate and filter entries
    const validEntries: Record<string, T> = {};
    for (const [key, data] of entriesArray) {
      if (this.isValidKey(key) && data !== undefined) {
        validEntries[key] = data;
      }
    }

    if (Object.keys(validEntries).length === 0) {
      this.logger.warn("No valid entries to set in mSet");
      return;
    }

    // Enforce TTL boundaries
    const effectiveTtl = Math.max(
      this.config.minTtl,
      Math.min(ttl ?? this.config.defaultTtl, this.config.maxTtl)
    );

    // Set across all cache levels
    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        await cache.mSet<T>(validEntries, effectiveTtl);
      } catch (error) {
        this.logger.error({ entryCount: Object.keys(validEntries).length, error: error instanceof Error ? error.message : String(error) }, `Cache mSet failed for level ${idx + 1}`);
        // Continue to next cache level even if one fails
      }
    }
  }

  /**
   * Get value from cache or compute it, preventing cache stampede
   */
  async getOrCompute<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    if (!this.isValidKey(key)) {
      throw new Error(`Invalid cache key: ${key}`);
    }

    // Try to get from cache first
    const cachedResult = await this.get<T>(key);
    if (cachedResult.data !== null) {
      return cachedResult.data;
    }

    // Not in cache, compute the value
    try {
      const computedValue = await computeFn();

      // Store in all cache levels
      const effectiveTtl = ttl ?? this.config.defaultTtl;
      await this.set(key, computedValue, effectiveTtl);

      return computedValue;
    } catch (error) {
      this.logger.error({ error: error instanceof Error ? error.message : String(error) }, `GetOrCompute failed for key: ${key}`);
      throw error;
    }
  }

  /**
   * Invalidate multiple cache entries by tags (treated as patterns)
   */
  async mInvalidate(tags: string[]): Promise<void> {
    if (!tags.length) {
      return;
    }

    // Validate tags
    const validTags = tags.filter((tag) => this.isValidKey(tag));
    if (validTags.length !== tags.length) {
      this.logger.warn({ totalTags: tags.length, validTags: validTags.length }, "Some invalid tags filtered out in mInvalidate");
    }

    let totalInvalidated = 0;

    // Invalidate across all cache levels
    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        await cache.mInvalidate(validTags);
        // Also try pattern-based invalidation for each tag
        for (const tag of validTags) {
          const count = await cache.invalidatePattern(`*${tag}*`);
          totalInvalidated += count;
        }
      } catch (error) {
        this.logger.error({ tags: validTags, error: error instanceof Error ? error.message : String(error) }, `Cache mInvalidate failed for level ${idx + 1}`);
        // Continue to next cache level even if one fails
      }
    }

    this.stats.invalidations += totalInvalidated;
    this.logger.info({ tags: validTags, totalInvalidated }, "Multi-tag invalidation completed");
  }

  /**
   * Set data in cache with intelligent TTL and compression
   */
  async set<T>(
    key: string,
    data: T,
    ttl: number = this.config.defaultTtl
  ): Promise<void> {
    // Input validation
    if (!this.isValidKey(key)) {
      return;
    }

    // Enforce TTL boundaries
    const effectiveTtl = Math.max(
      this.config.minTtl,
      Math.min(ttl || this.config.defaultTtl, this.config.maxTtl)
    );

    // Basic data validation - prevent storing undefined/null as data
    if (data === undefined) {
      this.logger.warn({ key }, "Attempted to cache undefined data");
      return;
    }

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        await cache.set<T>(key, data, effectiveTtl);
      } catch (error) {
        this.logger.error({ key, error: error instanceof Error ? error.message : String(error) }, `Cache set failed for level ${idx + 1}`);
        // Continue to next cache level even if one fails
      }
    }
  }

  /**
   * Invalidate cache entry at all levels
   */
  async invalidate(key: string): Promise<void> {
    // Input validation
    if (!this.isValidKey(key)) {
      return;
    }

    this.stats.invalidations++;

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        await cache.invalidate(key);
      } catch (error) {
        this.logger.error({ key, error: error instanceof Error ? error.message : String(error) }, `Cache invalidate failed for level ${idx + 1}`);
        // Continue to next cache level even if one fails
      }
    }

    this.logger.debug({ key }, "Cache entry invalidated");
  }

  /**
   * Batch invalidation for performance
   */
  async invalidatePattern(pattern: string): Promise<number> {
    // Input validation
    if (!this.isValidKey(pattern)) {
      return 0;
    }

    // Prevent dangerous patterns that could invalidate everything
    if (pattern === "*" || pattern === "*:*" || pattern.length < 2) {
      this.logger.warn(
        { pattern },
        "Dangerous pattern provided to invalidatePattern, blocking"
      );
      return 0;
    }

    let invalidatedCount = 0;

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        const count = await cache.invalidatePattern(pattern);
        invalidatedCount += count;
      } catch (error) {
        this.logger.error(
          { pattern, error: error instanceof Error ? error.message : String(error) },
          `Cache invalidatePattern failed for level ${idx + 1}`
        );
        // Continue to next cache level even if one fails
      }
    }

    this.stats.invalidations += invalidatedCount;
    this.logger.info({ pattern, count: invalidatedCount }, "Batch invalidation completed");

    return invalidatedCount;
  }

  /**
   * Warm up cache with frequently accessed data
   */
  private async warmupCache(): Promise<void> {
    try {
      await this.warmingManager.warmup(this, this.dataProvider, "static");
    } catch (error) {
      this.logger.error({ err: error }, "Cache warmup failed");
    }
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const stats = this.caches.map((cache) => cache.getStats());
    const totalHits = stats.map((stat) => stat.Hits).reduce((a, b) => a + b, 0);
    const totalRequests = stats
      .map((stat) => stat.totalRequests)
      .reduce((a, b) => a + b, 0);
    this.stats.Hits = totalHits;
    this.stats.totalRequests = totalRequests;
    this.stats.hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    // Aggregate stats from all caches
    const cacheStats = this.caches.map((cache) => cache.getStats());
    const totalHits = cacheStats
      .map((stat) => stat.Hits)
      .reduce((a, b) => a + b, 0);
    const totalMisses = cacheStats
      .map((stat) => stat.Misses)
      .reduce((a, b) => a + b, 0);
    const totalRequests = cacheStats
      .map((stat) => stat.totalRequests)
      .reduce((a, b) => a + b, 0);
    const totalMemoryUsage = cacheStats
      .map((stat) => stat.memoryUsage)
      .reduce((a, b) => a + b, 0);
    const totalEntryCount = cacheStats
      .map((stat) => stat.entryCount)
      .reduce((a, b) => a + b, 0);
    const totalInvalidations = cacheStats
      .map((stat) => stat.invalidations)
      .reduce((a, b) => a + b, 0);
    const totalCompressions = cacheStats
      .map((stat) => stat.compressions)
      .reduce((a, b) => a + b, 0);

    return {
      Hits: totalHits,
      Misses: totalMisses,
      totalRequests,
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      memoryUsage: totalMemoryUsage,
      entryCount: totalEntryCount,
      invalidations: totalInvalidations,
      compressions: totalCompressions,
    };
  }

  /**
   * Check if cache is enabled
   */
  async isEnabled(): Promise<boolean> {
    return Promise.resolve(this.config.enable);
  }

  /**
   * Cache health check - aggregates health from all caches
   */
  async healthCheck(): Promise<CacheHealth> {
    const healthChecks: CacheHealth[] = [];

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      const health = await cache.healthCheck();
      healthChecks.push(health);
    }

    // If no caches are available, return critical status
    if (healthChecks.length === 0) {
      return {
        status: "critical",
        capacity: "error",
        hitRate: 0,
        entryCount: 0,
      };
    }

    // Aggregate health metrics from all caches
    const totalEntries = healthChecks.reduce((sum, h) => sum + h.entryCount, 0);
    const avgHitRate =
      healthChecks.reduce((sum, h) => sum + h.hitRate, 0) / healthChecks.length;

    // Determine overall status - worst case wins
    const worstStatus = healthChecks.some((h) => h.status === "critical")
      ? "critical"
      : healthChecks.some((h) => h.status === "degraded")
        ? "degraded"
        : "healthy";

    // Determine overall capacity - worst case wins
    const worstCapacity = healthChecks.some((h) => h.capacity === "error")
      ? "error"
      : healthChecks.some((h) => h.capacity === "full")
        ? "full"
        : "ok";

    return {
      status: worstStatus,
      capacity: worstCapacity,
      hitRate: avgHitRate,
      entryCount: totalEntries,
    };
  }

  /**
   * Warm up cache using specified strategy
   */
  async warmup(strategyName: string = "static"): Promise<CacheWarmingResult> {
    return this.warmingManager.warmup(this, this.dataProvider, strategyName);
  }

  /**
   * Warm up cache using all strategies
   */
  async warmupAll(): Promise<Map<string, CacheWarmingResult>> {
    return this.warmingManager.warmupAll(this, this.dataProvider);
  }

  /**
   * Start background warming
   */
  startBackgroundWarming(): void {
    this.warmingManager.startBackgroundWarming(this, this.dataProvider);
  }

  /**
   * Stop background warming
   */
  stopBackgroundWarming(): void {
    this.warmingManager.stopBackgroundWarming();
  }

  /**
   * Get cache warming statistics
   */
  getWarmingStats(): {
    strategies: string[];
    backgroundStatus?: {
      isRunning: boolean;
      intervalSeconds: number;
      activeWarmups: number;
      maxConcurrentWarmups: number;
    };
    adaptiveStats?: { totalPatterns: number; topKeys: string[] };
  } {
    return this.warmingManager.getStats();
  }

  /**
   * Get recommended keys for warming
   */
  getRecommendedKeys(): Map<string, string[]> {
    return this.warmingManager.getRecommendedKeys();
  }

  private resetStats(): void {
    this.stats.Hits = 0;
    this.stats.Misses = 0;
    this.stats.totalRequests = 0;
    this.stats.hitRate = 0;
    this.stats.memoryUsage = 0;
    this.stats.entryCount = 0;
    this.stats.invalidations = 0;
    this.stats.compressions = 0;
  }
  /**
   * Dispose of cache resources and cleanup
   */
  async dispose(): Promise<void> {
    try {
      // Stop background warming
      this.stopBackgroundWarming();

      // Clear all cache levels
      for (const cache of this.caches) {
        if (cache && typeof cache.dispose === "function") {
          try {
            await cache.dispose();
          } catch (error) {
            this.logger.error({ err: error }, "Error disposing cache");
          }
        }
      }
      this.resetStats();
      this.logger.info("CacheService disposed successfully");
    } catch (error) {
      this.logger.error({ err: error }, "Error during CacheService disposal");
    }
  }
}
