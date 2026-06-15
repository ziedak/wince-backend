export interface CacheConfig {
  readonly defaultTtl: number; // seconds
  readonly maxTtl: number; // seconds
  readonly minTtl: number; // seconds
  readonly compression?:
    | {
        readonly enable: boolean;
        readonly threshold: number; // bytes
        readonly algorithm: "gzip" | "brotli" | "deflate";
      }
    | undefined;
  readonly enable: boolean;
  readonly warmupOnStart?: boolean | undefined;
  readonly warmingConfig?: CacheWarmingConfig | undefined;
}

export interface CacheWarmingConfig {
  readonly enableBackgroundWarming?: boolean;
  readonly backgroundWarmingInterval?: number; // seconds
  readonly adaptiveWarming?: boolean;
  readonly maxWarmupKeys?: number;
  readonly warmupBatchSize?: number;
  readonly enablePatternLearning?: boolean;
}

export interface WarmupDataProvider<T = unknown> {
  getWarmupKeys(): Promise<string[]>;
  loadDataForKey(key: string): Promise<T | null>;
  getKeyPriority(key: string): number; // Higher number = higher priority
}

export interface CacheWarmingStrategy {
  readonly name: string;
  warmup(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<CacheWarmingResult>;
  getRecommendedKeys(): string[];
}

export interface CacheWarmingResult {
  success: boolean;
  keysProcessed: number;
  keysFailed: number;
  duration: number;
  errors: string[];
}

export interface AccessPattern {
  key: string;
  accessCount: number;
  lastAccessed: number;
  averageLatency: number;
  priority: number;
}
export interface CacheOperationResult<T> {
  data: T | null;
  source: string | "miss";
  latency: number;
  compressed: boolean;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
  compressed: boolean;
  compressionAlgorithm?: string; // Algorithm used for compression
}

export interface CacheStats {
  Hits: number;
  Misses: number;
  totalRequests: number;
  hitRate: number;
  memoryUsage: number;
  entryCount: number;
  invalidations: number;
  compressions: number;
}

// Statistics
export const DEFAULT_CACHE_STATS: CacheStats = {
  Hits: 0,
  Misses: 0,
  totalRequests: 0,
  hitRate: 0,
  memoryUsage: 0,
  entryCount: 0,
  invalidations: 0,
  compressions: 0,
};

export interface CacheHealth {
  status: "healthy" | "degraded" | "critical";
  capacity: "ok" | "full" | "error";
  hitRate: number;
  entryCount: number;
}

export interface ICache {
  /**
   * Checks if the cache is enabled.
   * @returns {Promise<boolean>} True if the cache is enabled, false otherwise.
   */
  isEnabled(): Promise<boolean>;

  /**
   * Retrieves a value from the cache by key.
   * @template T - The type of the cached data.
   * @param {string} key - The cache key.
   * @returns {Promise<CacheOperationResult<T>>} The cache operation result.
   */
  get<T>(key: string): Promise<CacheOperationResult<T>>;

  /**
   * Sets a value in the cache with an optional TTL.
   * @template T - The type of the data to cache.
   * @param {string} key - The cache key.
   * @param {T} data - The data to cache.
   * @param {number} [ttl] - Time to live in seconds.
   * @returns {Promise<void>}
   */
  set<T>(key: string, data: T, ttl?: number): Promise<void>;

  /**
   * Invalidates a specific cache entry by key.
   * @param {string} key - The cache key to invalidate.
   * @returns {Promise<void>}
   */
  invalidate(key: string): Promise<void>;

  /**
   * Invalidates cache entries matching a pattern.
   * @param {string} pattern - The pattern to match keys.
   * @returns {Promise<number>} The number of invalidated entries.
   */
  invalidatePattern(pattern: string): Promise<number>;

  /**
   * Checks if a key exists in the cache.
   * @param {string} key - The cache key.
   * @returns {Promise<boolean>} True if the key exists, false otherwise.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Atomically increments a counter by delta, creating the key with delta if it doesn't exist.
   * @param {string} key - The cache key.
   * @param {number} [delta=1] - The increment value.
   * @returns {Promise<number>} The new value after increment.
   */
  increment(key: string, delta?: number): Promise<number>;

  /**
   * Sets or updates the TTL for an existing key.
   * @param {string} key - The cache key.
   * @param {number} ttl - Time to live in seconds.
   * @returns {Promise<boolean>} True if the key exists and TTL was set, false otherwise.
   */
  expire(key: string, ttl: number): Promise<boolean>;

  /**
   * Gets the remaining TTL for a key.
   * @param {string} key - The cache key.
   * @returns {Promise<number>} Seconds remaining, -1 if no expiry, -2 if key does not exist.
   */
  getTTL(key: string): Promise<number>;

  /**
   * Batch retrieves multiple keys, maintaining order of results.
   * @template T - The type of the cached data.
   * @param {string[]} keys - Array of cache keys.
   * @returns {Promise<(T | null)[]>} Array of values, null for missing keys.
   */
  mGet<T>(keys: string[]): Promise<(T | null)[]>;

  /**
   * Batch sets multiple keys with the same TTL.
   * @template T - The type of the data to cache.
   * @param {Record<string, T>} entries - Key-value pairs to set.
   * @param {number} [ttl] - Time to live in seconds for all keys.
   * @returns {Promise<void>}
   */
  mSet<T>(entries: Record<string, T>, ttl?: number): Promise<void>;

  /**
   * Gets a value from cache or computes it if missing, then caches the result.
   * Prevents cache stampede with locking.
   * @template T - The type of the data.
   * @param {string} key - The cache key.
   * @param {() => Promise<T>} computeFn - Async function to compute the value.
   * @param {number} [ttl] - Time to live in seconds.
   * @returns {Promise<T>} The cached or computed value.
   */
  getOrCompute<T>(
    key: string,
    computeFn: () => Promise<T>,
    ttl?: number
  ): Promise<T>;

  /**
   * Invalidates all cache entries associated with the given tags.
   * Requires tag tracking.
   * @param {string[]} tags - Array of tags.
   * @returns {Promise<void>}
   */
  mInvalidate(tags: string[]): Promise<void>;

  /**
   * Retrieves cache statistics.
   * @returns {CacheStats} The cache statistics.
   */
  getStats(): CacheStats;

  /**
   * Performs a health check on the cache.
   * @returns {Promise<CacheHealth>} The cache health status.
   */
  healthCheck(): Promise<CacheHealth>;

  /**
   * Optional cleanup method to dispose of resources.
   * @returns {Promise<void>}
   */
  dispose?(): Promise<void>;
}
