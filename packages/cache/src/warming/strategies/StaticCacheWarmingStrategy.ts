/**
 * Static Cache Warming Strategy
 * Warms cache with a predefined set of frequently accessed keys
 */

import type { ICache, WarmupDataProvider, CacheWarmingResult } from "../../interfaces/ICache.js";
import { BaseCacheWarmingStrategy } from "./BaseCacheWarmingStrategy.js";



/**
 * Static warming strategy with predefined keys
 */
export class StaticCacheWarmingStrategy extends BaseCacheWarmingStrategy {
  readonly name = "Static";

  private readonly predefinedKeys: string[];

  constructor(predefinedKeys: string[] = []) {
    super();
    this.predefinedKeys =
      predefinedKeys.length > 0 ? predefinedKeys : this.getDefaultKeys();
  }

  async warmup(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<CacheWarmingResult> {
    // Get keys from provider or use predefined keys
    const keys = await provider
      .getWarmupKeys()
      .catch(() => this.predefinedKeys);

    // Sort by priority if provider supports it
    const prioritizedKeys = keys.sort((a, b) => {
      const priorityA = provider.getKeyPriority(a);
      const priorityB = provider.getKeyPriority(b);
      return priorityB - priorityA; // Higher priority first
    });

    return this.executeWarmup(cache, provider, prioritizedKeys);
  }

  getRecommendedKeys(): string[] {
    return [...this.predefinedKeys];
  }

  private getDefaultKeys(): string[] {
    // Default keys for authentication system
    return [
      "user:profile:*",
      "session:active:*",
      "permissions:role:*",
      "auth:tokens:*",
      "user:preferences:*",
      "system:config:*",
      "cache:metadata:*",
    ];
  }
}
