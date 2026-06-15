/**
 * Cache Warming Manager
 * Orchestrates multiple cache warming strategies
 */

import { createLogger } from "@org/logger";
import type {
  ICache,
  CacheWarmingConfig,
  CacheWarmingResult,
  WarmupDataProvider,
  CacheWarmingStrategy,
} from "../interfaces/ICache.js";
import { AdaptiveCacheWarmingStrategy } from "./strategies/AdaptiveCacheWarmingStrategy.js";
import { BackgroundCacheWarmingStrategy } from "./strategies/BackgroundCacheWarmingStrategy.js";
import { StaticCacheWarmingStrategy } from "./strategies/StaticCacheWarmingStrategy.js";

/**
 * Manager for cache warming strategies
 */
export class CacheWarmingManager {
  private readonly strategies: Map<string, CacheWarmingStrategy> = new Map();
  private readonly logger = createLogger({ service: 'CacheWarmingManager' });

  constructor(private readonly config: CacheWarmingConfig = {}) {
    this.initializeStrategies();
  }

  /**
   * Initialize warming strategies
   */
  private initializeStrategies(): void {
    // Static strategy for predefined keys
    this.strategies.set("static", new StaticCacheWarmingStrategy());

    // Adaptive strategy for learning from access patterns
    if (this.config.adaptiveWarming) {
      this.strategies.set("adaptive", new AdaptiveCacheWarmingStrategy());
    }

    // Background strategy for periodic warming
    if (this.config.enableBackgroundWarming) {
      this.strategies.set(
        "background",
        new BackgroundCacheWarmingStrategy(
          this.config.backgroundWarmingInterval ?? 300
        )
      );
    }
  }

  /**
   * Warm up cache using specified strategy
   */
  async warmup(
    cache: ICache,
    provider: WarmupDataProvider,
    strategyName: string = "static"
  ): Promise<CacheWarmingResult> {
    const strategy = this.strategies.get(strategyName);

    if (!strategy) {
      const error = `Unknown warming strategy: ${strategyName}`;
      this.logger.error(error);
      return {
        success: false,
        keysProcessed: 0,
        keysFailed: 0,
        duration: 0,
        errors: [error],
      };
    }

    this.logger.info({ message: 'Starting cache warmup', strategy: strategyName });
    const result = await strategy.warmup(cache, provider);

    this.logger.info({
      message: 'Cache warmup completed',
      strategy: strategyName,
      success: result.success,
      keysProcessed: result.keysProcessed,
      duration: Math.round(result.duration),
    });

    return result;
  }

  /**
   * Warm up cache using all available strategies
   */
  async warmupAll(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<Map<string, CacheWarmingResult>> {
    const results = new Map<string, CacheWarmingResult>();

    for (const [name, strategy] of this.strategies.entries()) {
      try {
        const result = await strategy.warmup(cache, provider);
        results.set(name, result);
      } catch (error) {
        this.logger.error({
          message: `Strategy ${name} failed`,
          error: error as Error,
        });
        results.set(name, {
          success: false,
          keysProcessed: 0,
          keysFailed: 0,
          duration: 0,
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }

    return results;
  }

  /**
   * Start background warming
   */
  startBackgroundWarming(cache: ICache, provider: WarmupDataProvider): void {
    const backgroundStrategy = this.strategies.get(
      "background"
    ) as BackgroundCacheWarmingStrategy;
    if (backgroundStrategy) {
      backgroundStrategy.startBackgroundWarming(cache, provider);
    } else {
      this.logger.warn({ message: 'Background warming not enabled' });
    }
  }

  /**
   * Stop background warming
   */
  stopBackgroundWarming(): void {
    const backgroundStrategy = this.strategies.get(
      "background"
    ) as BackgroundCacheWarmingStrategy;
    if (backgroundStrategy) {
      backgroundStrategy.stopBackgroundWarming();
    }
  }

  /**
   * Record access pattern for adaptive learning
   */
  recordAccess(key: string, latency: number): void {
    const adaptiveStrategy = this.strategies.get(
      "adaptive"
    ) as AdaptiveCacheWarmingStrategy;
    if (adaptiveStrategy) {
      adaptiveStrategy.recordAccess(key, latency);
    }
  }

  /**
   * Get recommended keys from all strategies
   */
  getRecommendedKeys(): Map<string, string[]> {
    const recommendations = new Map<string, string[]>();

    for (const [name, strategy] of this.strategies.entries()) {
      const keys = strategy.getRecommendedKeys();
      if (keys.length > 0) {
        recommendations.set(name, keys);
      }
    }

    return recommendations;
  }

  /**
   * Get warming statistics
   */
  getStats(): {
    strategies: string[];
    backgroundStatus?: {
      isRunning: boolean;
      intervalSeconds: number;
      activeWarmups: number;
      maxConcurrentWarmups: number;
    };
    adaptiveStats?: { totalPatterns: number; topKeys: string[] };
  } {
    const stats: {
      strategies: string[];
      backgroundStatus?: {
        isRunning: boolean;
        intervalSeconds: number;
        activeWarmups: number;
        maxConcurrentWarmups: number;
      };
      adaptiveStats?: { totalPatterns: number; topKeys: string[] };
    } = {
      strategies: Array.from(this.strategies.keys()),
    };

    const backgroundStrategy = this.strategies.get(
      "background"
    ) as BackgroundCacheWarmingStrategy;
    if (backgroundStrategy) {
      stats.backgroundStatus = backgroundStrategy.getStatus();
    }

    const adaptiveStrategy = this.strategies.get(
      "adaptive"
    ) as AdaptiveCacheWarmingStrategy;
    if (adaptiveStrategy) {
      stats.adaptiveStats = adaptiveStrategy.getAccessPatternStats();
    }

    return stats;
  }
}
