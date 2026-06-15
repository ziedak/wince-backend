/**
 * Redis-First Authentication Cache Layer
 * Phase 1: Implement intelligent caching for authentication operations
 *
 * This service provides:
 * - Multi-level caching (: memory, L2: Redis, L3: database)
 * - Cache warming and invalidation strategies
 * - Performance monitoring and hit rate optimization
 */

import { matchPattern } from "@org/utils";
import { LRUCache } from "lru-cache";
import {
  type CacheConfig,
  type CacheEntry,
  type CacheHealth,
  type CacheOperationResult,
} from "../interfaces/ICache.js";
import {
  MemoryTracker,
  type MemoryStats,
  type MemoryTrackerConfig,
} from "../utils/MemoryTracker.js";
import {
  type CompressionConfig,
  DEFAULT_COMPRESSION_CONFIG,
  DEFAULT_DECOMPRESSION_CONFIG,
} from "../utils/CacheCompressor.js";
import { compress, decompress } from "../utils/CacheCompressor.js";
import { BaseCache } from "./BaseCache.js";

export interface MemoryCacheConfig extends CacheConfig {
  readonly maxMemoryCacheSize: number; // entries (for LRU limit)
  readonly memoryConfig?: Partial<MemoryTrackerConfig>; // Memory management config
  readonly compressionConfig?: Partial<CompressionConfig>; // Compression config
}

export const DEFAULT_MEMORY_CACHE_CONFIG: MemoryCacheConfig = {
  enable: true,
  maxMemoryCacheSize: 10000, // 10k entries
  memoryConfig: {
    maxMemoryMB: 50, // 50MB default
    warningThresholdPercent: 75,
    criticalThresholdPercent: 90,
    enableDetailedTracking: true,
    sizeCalculationInterval: 50,
  },
  compressionConfig: DEFAULT_COMPRESSION_CONFIG,
  defaultTtl: 3600, // 1 hour
  minTtl: 60, // 1 minute
  maxTtl: 86400, // 24 hours
};

/**
 * Memory-based LRU cache implementation
 */
export class MemoryCache extends BaseCache<MemoryCacheConfig> {
  private readonly memoryCache: LRUCache<string, CacheEntry<unknown>>;
  private readonly memoryTracker: MemoryTracker;

  constructor(config: Partial<MemoryCacheConfig> = {}) {
    const fullConfig = { ...DEFAULT_MEMORY_CACHE_CONFIG, ...config };
    super(fullConfig);

    // Initialize memory tracker
    this.memoryTracker = new MemoryTracker(fullConfig.memoryConfig);

    // Use LRUCache properly - it handles all LRU logic internally
    this.memoryCache = new LRUCache<string, CacheEntry<unknown>>({
      max: fullConfig.maxMemoryCacheSize,
      ttl: fullConfig.defaultTtl * 1000, // Convert to milliseconds
    });

    this.logger.info({message: "MemoryCache initialized", 
      maxEntries: fullConfig.maxMemoryCacheSize,
      memoryLimitMB: fullConfig.memoryConfig?.maxMemoryMB ?? 50,
      compressionEnabled: fullConfig.compressionConfig?.enableCompression,
    });
  }

  /**
   * Set data in memory cache
   */
  override async set<T>(
    key: string,
    data: T,
    ttl: number = this.config.defaultTtl
  ): Promise<void> {
    await super.set(key, data, ttl);
  }

  /**
   * Cache health check
   */
  async healthCheck(): Promise<CacheHealth> {
    // Update stats to reflect current state
    this.updateMemoryStats();

    const result: CacheHealth = {
      status: "healthy",
      capacity: "ok",
      hitRate: this.stats.hitRate,
      entryCount: this.stats.entryCount,
    };

    // Check memory usage
    const memoryStats = this.memoryTracker.getMemoryStats();
    if (!memoryStats.isWithinLimits) {
      result.status = "critical";
      result.capacity = "error";
    } else if (
      memoryStats.usagePercent >=
      (this.config.memoryConfig?.warningThresholdPercent ?? 75)
    ) {
      result.status = "degraded";
      result.capacity = "full";
    }

    // Check L1 cache entry limit
    if (this.memoryCache.size >= this.config.maxMemoryCacheSize * 0.9) {
      result.capacity = result.capacity === "error" ? "error" : "full";
      result.status = result.status === "critical" ? "critical" : "degraded";
    }

    return Promise.resolve(result);
  }

  /**
   * Get detailed memory statistics
   */
  getMemoryStats(): MemoryStats {
    return this.memoryTracker.getMemoryStats();
  }

  /**
   * Get memory tracker configuration
   */
  getMemoryConfig(): Partial<MemoryTrackerConfig> | undefined {
    return this.config.memoryConfig;
  }

  /**
   * Check if adding an entry would exceed memory limits
   */
  private checkMemoryLimits(key: string, data: unknown): boolean {
    // If we're replacing an existing entry, account for the memory we'll free up
    const existingEntry = this.memoryCache.get(key);
    let projectedUsage = this.memoryTracker.getTotalMemoryUsage();

    if (existingEntry) {
      // Subtract existing entry size
      const existingInfo = this.memoryTracker.getEntryMemoryInfo(key);
      if (existingInfo) {
        projectedUsage -= existingInfo.totalSize;
      }
    }

    // Add new entry size
    const newEntrySize =
      this.memoryTracker.calculateObjectSize(key) +
      this.memoryTracker.calculateObjectSize(data) +
      this.memoryTracker.calculateObjectSize({
        timestamp: Date.now(),
        ttl: this.config.defaultTtl,
        hits: 0,
        compressed: false,
      });

    projectedUsage += newEntrySize;

    const maxBytes =
      (this.config.memoryConfig?.maxMemoryMB ?? 50) * 1024 * 1024;
    const usagePercent = (projectedUsage / maxBytes) * 100;

    return (
      usagePercent < (this.config.memoryConfig?.criticalThresholdPercent ?? 90)
    );
  }

  /**
   * Update memory usage statistics
   */
  private updateMemoryStats(): void {
    this.stats.entryCount = this.memoryCache.size;
    this.stats.memoryUsage = this.memoryTracker.getTotalMemoryUsage();

    // Log memory stats periodically
    if (this.stats.totalRequests % 100 === 0) {
      const memoryStats = this.memoryTracker.getMemoryStats();
      this.logger.debug({ message: "Memory cache stats", entries: this.stats.entryCount, memoryMB: Math.round(memoryStats.totalUsageMB * 100) / 100, usagePercent: Math.round(memoryStats.usagePercent * 100) / 100, averageEntrySize: Math.round(memoryStats.averageEntrySize) });
    }
  }

  // Abstract method implementations
  protected async doGet<T>(
    key: string
  ): Promise<CacheOperationResult<T> | null> {
    const entry = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    if (entry) {
      // Decompress data if it was compressed
      const { data: entryData, compressed } = entry;
      let data = entryData;
      if (entry.compressed) {
        try {
          this.logger.debug( {
            message: "Decompressing cache entry",
            key,
            dataType: typeof entry.data,
            isArray: Array.isArray(entry.data),
            isBuffer: Buffer.isBuffer(entry.data),
            hasKeys:
              entry.data && typeof entry.data === "object"
                ? Object.keys(entry.data).slice(0, 10)
                : [],
          });

          const { data: decompressedData } = await decompress(
            entry.data,
            DEFAULT_DECOMPRESSION_CONFIG
          );
          data = decompressedData as T;

          this.logger.debug({
            message: "✅ Successfully decompressed data",
            key,
            decompressedType: typeof data,
            hasAccessToken:
              data && typeof data === "object" && "access_token" in data,
          });
        } catch (error) {
          this.logger.error({ message: "Failed to decompress cache entry", key, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, dataType: typeof entry.data });

          // Return null on decompression failure to force re-fetch
          return null;
        }
      }

      return {
        data,
        source: "l1",
        latency: 0, // Will be set by base class
        compressed,
      };
    }
    return null;
  }

  protected async doSet<T>(key: string, data: T, ttl: number): Promise<void> {
    // Basic data validation - prevent storing undefined as data
    if (data === undefined) {
      this.logger.warn({ message: "Attempted to cache undefined data", key });
      return;
    }

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
          // Store the entire compressed data object, not just the data field
          // This is required for decompression to work properly
          finalData = compressionResult.data as T;
          compressed = true;
          compressionAlgorithm = compressionResult.algorithm;
          this.stats.compressions++;
        }
      } catch (error) {
        this.logger.warn({ message: "Compression failed, storing uncompressed data", key, error: error instanceof Error ? error.message : String(error) });
      }
    }

    // Check memory limits before adding
    if (!this.checkMemoryLimits(key, finalData)) {
      this.logger.warn({ message: "Memory limit exceeded, skipping cache set", key, currentUsage: this.memoryTracker.getMemoryUsagePercent(), limit: this.config.memoryConfig?.criticalThresholdPercent ?? 90 });
      return;
    }

    const entry: CacheEntry<T> = {
      data: finalData as T,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      compressed,
      ...(compressionAlgorithm && { compressionAlgorithm }),
    };

    // Track memory usage before setting
    const metadata = {
      timestamp: entry.timestamp,
      ttl: entry.ttl,
      hits: entry.hits,
      compressed: entry.compressed,
      compressionAlgorithm: entry.compressionAlgorithm,
    };
    this.memoryTracker.trackEntry(key, finalData, metadata);

    this.memoryCache.set(key, entry);
    this.updateMemoryStats();

    this.logger.debug({ message: "Memory cache entry set", key, ttl, compressed, compressionAlgorithm, memoryUsage: this.memoryTracker.getTotalMemoryUsageMB() });
  }

  protected async doInvalidate(key: string): Promise<void> {
    this.memoryCache.delete(key);
    this.memoryTracker.removeEntry(key);
    this.logger.debug({ message: "Cache entry invalidated", key });
    await Promise.resolve();
  }

  protected async doInvalidatePattern(pattern: string): Promise<number> {
    let invalidatedCount = 0;

    //  pattern invalidation - use LRUCache keys() method
    const Keys: string[] = Array.from(this.memoryCache.keys());
    for (const key of Keys) {
      if (matchPattern(key, pattern)) {
        this.memoryCache.delete(key);
        this.memoryTracker.removeEntry(key);
        invalidatedCount++;
      }
    }

    await Promise.resolve();
    return invalidatedCount;
  }

  protected async doExists(key: string): Promise<boolean> {
    return Promise.resolve(this.memoryCache.has(key));
  }

  protected async doIncrement(key: string, delta: number): Promise<number> {
    const entry = this.memoryCache.get(key) as CacheEntry<number> | undefined;

    if (entry && typeof entry.data === "number") {
      // Update existing counter
      const newValue = entry.data + delta;
      entry.data = newValue;
      entry.timestamp = Date.now();
      entry.hits++;
      this.memoryCache.set(key, entry);
      return Promise.resolve(newValue);
    }

    // Create new counter
    const newValue = delta;
    const newEntry: CacheEntry<number> = {
      data: newValue,
      timestamp: Date.now(),
      ttl: this.config.defaultTtl,
      hits: 0,
      compressed: false,
    };

    this.memoryTracker.trackEntry(key, newValue, {
      timestamp: newEntry.timestamp,
      ttl: newEntry.ttl,
      hits: newEntry.hits,
      compressed: newEntry.compressed,
    });

    this.memoryCache.set(key, newEntry);
    this.updateMemoryStats();

    return Promise.resolve(newValue);
  }

  protected async doExpire(key: string, ttl: number): Promise<boolean> {
    const entry = this.memoryCache.get(key);
    if (!entry) {
      return Promise.resolve(false);
    }

    // Update TTL by recreating the entry with new TTL
    entry.ttl = ttl;
    this.memoryCache.set(key, entry, { ttl: ttl * 1000 }); // Convert to milliseconds

    return Promise.resolve(true);
  }

  protected async doGetTTL(key: string): Promise<number> {
    const entry = this.memoryCache.get(key);
    if (!entry) {
      return Promise.resolve(-2); // Key does not exist
    }

    const remainingTime = this.memoryCache.getRemainingTTL(key);
    if (remainingTime === 0) {
      return Promise.resolve(-1); // No expiry set
    }

    return Promise.resolve(Math.ceil(remainingTime / 1000)); // Convert milliseconds to seconds
  }

  protected async doMGet<T>(keys: string[]): Promise<(T | null)[]> {
    const results: (T | null)[] = [];

    for (const key of keys) {
      const entry = this.memoryCache.get(key) as CacheEntry<T> | undefined;

      if (!entry) {
        results.push(null);
        continue;
      }

      // Handle decompression if needed
      const { data, compressed } = entry;
      let finalData = data;
      if (compressed) {
        try {
          const { data: decompressedData } = await decompress(
            data,
            DEFAULT_DECOMPRESSION_CONFIG
          );
          finalData = decompressedData as T;
        } catch (error) {
          this.logger.warn({ message: "Failed to decompress cache entry in mGet", key, error: error instanceof Error ? error.message : String(error) });
        }
      }

      results.push(finalData);
    }

    return results;
  }

  protected async doMSet<T>(
    entries: Record<string, T>,
    ttl: number
  ): Promise<void> {
    for (const [key, data] of Object.entries(entries)) {
      await this.doSet(key, data, ttl);
    }
  }

  protected async doMInvalidate(tags: string[]): Promise<void> {
    // For memory cache, treat tags as key patterns
    for (const tag of tags) {
      await this.doInvalidatePattern(`*${tag}*`);
    }
  }

  /**
   * Dispose of memory cache resources
   */
  async dispose(): Promise<void> {
    try {
      // Clear all entries
      this.memoryCache.clear();

      // Clear memory tracker
      this.memoryTracker.clear();

      this.logger.info({ message: "MemoryCache disposed successfully" });
      await Promise.resolve();
    } catch (error) {
      this.logger.error({ message: "Error during MemoryCache disposal", error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
  }
}
