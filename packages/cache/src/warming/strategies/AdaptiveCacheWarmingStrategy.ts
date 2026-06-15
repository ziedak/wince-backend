/**
 * Adaptive Cache Warming Strategy
 * Learns from access patterns and warms cache with frequently accessed data
 */

import type {
  ICache,
  CacheWarmingResult,
  WarmupDataProvider,
  AccessPattern,
} from "../../interfaces/ICache.js";
import { BaseCacheWarmingStrategy } from "./BaseCacheWarmingStrategy.js";

/**
 * Adaptive warming strategy that learns from access patterns
 */
export class AdaptiveCacheWarmingStrategy extends BaseCacheWarmingStrategy {
  readonly name = "Adaptive";

  private readonly accessPatterns: Map<string, AccessPattern> = new Map();
  private readonly maxPatterns: number;
  private readonly minAccessCount: number;

  constructor(maxPatterns: number = 1000, minAccessCount: number = 5) {
    super();
    this.maxPatterns = maxPatterns;
    this.minAccessCount = minAccessCount;
  }

  async warmup(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<CacheWarmingResult> {
    // Get keys based on access patterns
    const keys = this.getKeysByAccessPattern();

    // If we don't have enough patterns, fall back to provider
    if (keys.length < 10) {
      const providerKeys = await provider.getWarmupKeys().catch(() => []);
      keys.push(...providerKeys.slice(0, 50)); // Add up to 50 more keys
    }

    // Remove duplicates and limit
    const uniqueKeys = [...new Set(keys)].slice(0, 100);

    return this.executeWarmup(cache, provider, uniqueKeys);
  }

  getRecommendedKeys(): string[] {
    return this.getKeysByAccessPattern().slice(0, 20);
  }

  /**
   * Record access pattern for learning
   */
  recordAccess(key: string, latency: number): void {
    const existing = this.accessPatterns.get(key);

    if (existing) {
      existing.accessCount++;
      existing.lastAccessed = Date.now();
      existing.averageLatency = (existing.averageLatency + latency) / 2;
      existing.priority = this.calculatePriority(existing);
    } else {
      const pattern: AccessPattern = {
        key,
        accessCount: 1,
        lastAccessed: Date.now(),
        averageLatency: latency,
        priority: 1,
      };
      this.accessPatterns.set(key, pattern);

      // Clean up old patterns if we exceed max
      if (this.accessPatterns.size > this.maxPatterns) {
        this.cleanupOldPatterns();
      }
    }
  }

  /**
   * Get keys sorted by access pattern priority
   */
  private getKeysByAccessPattern(): string[] {
    const patterns = Array.from(this.accessPatterns.values())
      .filter((pattern) => pattern.accessCount >= this.minAccessCount)
      .sort((a, b) => b.priority - a.priority);

    return patterns.map((p) => p.key);
  }

  /**
   * Calculate priority based on access patterns
   */
  private calculatePriority(pattern: AccessPattern): number {
    const recencyWeight = Math.max(
      0,
      1 - (Date.now() - pattern.lastAccessed) / (24 * 60 * 60 * 1000)
    ); // Decay over 24 hours
    const frequencyWeight = Math.min(pattern.accessCount / 100, 1); // Cap at 100 accesses
    const latencyWeight = Math.max(0, 1 - pattern.averageLatency / 1000); // Prefer faster responses

    return recencyWeight * 0.4 + frequencyWeight * 0.4 + latencyWeight * 0.2;
  }

  /**
   * Clean up old access patterns to prevent memory leaks
   */
  private cleanupOldPatterns(): void {
    const cutoffTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
    const lowPriorityCutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

    for (const [key, pattern] of this.accessPatterns.entries()) {
      if (
        pattern.lastAccessed < cutoffTime ||
        (pattern.accessCount < this.minAccessCount &&
          pattern.lastAccessed < lowPriorityCutoff)
      ) {
        this.accessPatterns.delete(key);
      }
    }

    this.logger.debug({ message: 'Cleaned up old access patterns', remaining: this.accessPatterns.size });
  }

  /**
   * Get access pattern statistics
   */
  getAccessPatternStats(): { totalPatterns: number; topKeys: string[] } {
    const patterns = Array.from(this.accessPatterns.values()).sort(
      (a, b) => b.accessCount - a.accessCount
    );

    return {
      totalPatterns: this.accessPatterns.size,
      topKeys: patterns.slice(0, 10).map((p) => p.key),
    };
  }
}
