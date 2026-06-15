# Cache Package

## Use Cases in This Project

The cache package is used across three services. Each use case targets a specific performance bottleneck in the event-processing pipeline.

---

### 1. Enrichment & Session Service — Customer Profile Cache

**Problem:** Every raw event triggers a `(store_id, distinct_id)` lookup in PostgreSQL. At high event throughput this is a bottleneck and adds latency to the enrichment path.

**Solution:** Multi-level cache (L1: in-process LRU, L2: Redis) for customer records. A cache hit serves from memory in <1 ms; a L2 hit from Redis avoids the DB round-trip. Only a full miss falls back to PostgreSQL.

**Key pattern:** `cache:customer:{store_id}:{distinct_id}` — TTL 5 min, matches the existing Redis key used by the service.

```typescript
import { CacheService } from "@org/cache";
import type { ICacheRedisClient } from "@org/cache";

const cache = CacheService.createMultiLevel(redisClient, {
  defaultTtl: 300,   // 5 minutes — matches existing TTL
  maxTtl: 600,
  minTtl: 60,
});

// On each raw event:
const key = `cache:customer:${storeId}:${distinctId}`;
const result = await cache.getOrCompute(key, () => db.findCustomer(storeId, distinctId), 300);
```

**Why multi-level:** The enrichment consumer group runs multiple instances. L1 reduces intra-instance Redis traffic; `CacheCoherencyManager` pub/sub keeps L1 in sync when a customer record is updated.

---

### 2. Decision Engine — Feature Cache

**Problem:** The decision engine pulls batch features from ClickHouse (`abandonment_rate_7d`, `avg_cart_value_30d`, etc.) for each session under evaluation. ClickHouse queries are expensive; features change slowly (hourly refresh is sufficient).

**Solution:** Redis-only cache for feature vectors, TTL 1 hour. Redis-only is intentional: the decision engine runs as multiple replicas and features must be consistent across instances.

**Key pattern:** `feature:{distinct_id}` — TTL 3600 s.

```typescript
const featureCache = CacheService.createRedisOnly(redisClient, {
  defaultTtl: 3600,  // 1 hour
  maxTtl: 7200,
  minTtl: 600,
});

async function getFeatures(distinctId: string): Promise<Features> {
  const result = await featureCache.getOrCompute(
    `feature:${distinctId}`,
    () => clickhouse.fetchFeatures(distinctId),
    3600
  );
  return result;
}
```

**Adaptive warming opportunity:** The `AdaptiveCacheWarmingStrategy` can learn which `distinct_id` values produce frequent decisions and pre-warm their features before the next decisioning cycle, eliminating cold-start misses after consumer rebalances.

```typescript
const decisionCache = CacheService.createRedisOnly(redisClient, {
  defaultTtl: 3600,
  warmupOnStart: false,
  warmingConfig: {
    adaptiveWarming: true,
    enablePatternLearning: true,
    maxWarmupKeys: 500,
    warmupBatchSize: 50,
  },
});
```

---

### 3. API Key Service — Key Lookup Cache

**Problem:** Every ingest request (`POST /v1/track`) requires the ingestion service to resolve the API key to a `store_id`. This is the hottest path and must stay under single-digit milliseconds.

**Solution:** Redis-only cache for API key metadata, TTL configurable (default 5 min). Redis-only ensures revoked keys propagate to all ingestion instances within one TTL window.

**Key pattern:** `apikey:{key_hash}` — never store the raw key as a cache key; hash it first.

```typescript
import { createHash } from "node:crypto";

const apiKeyCache = CacheService.createRedisOnly(redisClient, {
  defaultTtl: 300,   // 5 minutes
  maxTtl: 600,
  minTtl: 60,
});

async function lookupApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const cached = await apiKeyCache.get<ApiKeyRecord>(`apikey:${keyHash}`);
  if (cached.data) return cached.data;

  const record = await db.findApiKey(rawKey);
  if (record) {
    await apiKeyCache.set(`apikey:${keyHash}`, record, 300);
  }
  return record;
}
```

**Invalidation:** When a key is revoked, call `apiKeyCache.invalidate(`apikey:${keyHash}`)` directly. `CacheCoherencyManager` will broadcast the invalidation to all instances via Redis pub/sub.

---

### ICacheRedisClient — Wiring to `@org/redis_client`

The cache package depends on the `ICacheRedisClient` interface (not directly on `@org/redis_client`). You need to provide an adapter that wraps the raw ioredis client:

```typescript
import Redis from "ioredis";
import { createRedisClient } from "@org/redis_client";
import type { ICacheRedisClient } from "@org/cache";

export function createCacheRedisClient(url: string): ICacheRedisClient {
  const redis = createRedisClient({ url });

  return {
    isHealthy: async () => {
      try { await redis.ping(); return true; } catch { return false; }
    },
    ping: async () => { await redis.ping(); },
    safeGet: (key) => redis.get(key),
    safeSetEx: (key, ttl, val) => redis.setex(key, ttl, val).then(() => undefined),
    safeDel: (...keys) => redis.del(...keys).then(() => undefined),
    safeKeys: (pattern) => redis.keys(pattern),
    safeMget: (...keys) => redis.mget(...keys),
    exists: (key) => redis.exists(key),
    safePublish: (channel, msg) => redis.publish(channel, msg),
    getRedis: () => redis,
    createSubscriber: () => {
      const sub = redis.duplicate();
      return {
        on: sub.on.bind(sub),
        subscribe: (ch) => sub.subscribe(ch).then(() => undefined),
        unsubscribe: (ch) => sub.unsubscribe(ch).then(() => undefined),
        quit: () => sub.quit().then(() => undefined),
        disconnect: () => sub.disconnect(),
      };
    },
  };
}
```

---

## Cache Warming Strategies

This module provides intelligent cache warming strategies for frequently accessed data, improving application performance by pre-populating caches with hot data.

## Features

- **Static Warming**: Predefined keys based on known access patterns
- **Adaptive Warming**: Learns from access patterns and warms frequently accessed data
- **Background Warming**: Continuous warming at regular intervals
- **Multi-strategy Support**: Combine different warming approaches
- **Performance Monitoring**: Track warming effectiveness and metrics

## Quick Start

```typescript
import { CacheService } from "./cache.service";

// Create cache with warming enabled
const cache = new CacheService(logger, redisClient, {
  enable: true,
  defaultTTL: 3600,
  warmupOnStart: true,
  warmingConfig: {
    enableBackgroundWarming: true,
    backgroundWarmingInterval: 300, // 5 minutes
    adaptiveWarming: true,
    maxWarmupKeys: 100,
  },
});

// Cache will automatically warm on startup
// Access patterns are learned automatically
await cache.set("user:profile:123", userData);
const data = await cache.get("user:profile:123");
```

## Warming Strategies

### 1. Static Warming

Pre-warms cache with predefined frequently accessed keys.

```typescript
// Warm cache with static strategy
const result = await cache.warmup("static");
console.log(`Warmed ${result.keysProcessed} keys in ${result.duration}ms`);
```

### 2. Adaptive Warming

Learns from access patterns and warms cache with frequently accessed data.

```typescript
// Simulate access patterns
for (let i = 0; i < 10; i++) {
  await cache.get("hot:key");
}

// Warm based on learned patterns
const result = await cache.warmup("adaptive");
```

### 3. Background Warming

Continuously warms cache at regular intervals.

```typescript
// Start background warming
cache.startBackgroundWarming();

// Check status
const stats = cache.getWarmingStats();
console.log("Background status:", stats.backgroundStatus);

// Stop when needed
cache.stopBackgroundWarming();
```

## Configuration

```typescript
interface CacheWarmingConfig {
  enableBackgroundWarming?: boolean; // Enable periodic warming
  backgroundWarmingInterval?: number; // Interval in seconds (default: 300)
  adaptiveWarming?: boolean; // Enable pattern learning (default: true)
  maxWarmupKeys?: number; // Max keys to warm (default: 100)
  warmupBatchSize?: number; // Batch size for warming (default: 10)
  enablePatternLearning?: boolean; // Learn from access patterns (default: true)
}
```

## Advanced Usage

### Custom Data Provider

```typescript
import { WarmupDataProvider } from "./interfaces/ICache";

class CustomDataProvider implements WarmupDataProvider {
  async getWarmupKeys(): Promise<string[]> {
    return ["custom:key:1", "custom:key:2"];
  }

  async loadDataForKey(key: string): Promise<any> {
    // Load data from your data source
    return await database.load(key);
  }

  getKeyPriority(key: string): number {
    // Return priority (higher = more important)
    return key.includes("important") ? 10 : 1;
  }
}
```

### Custom Warming Strategy

```typescript
import { BaseCacheWarmingStrategy } from "./warming/BaseCacheWarmingStrategy";

class CustomWarmingStrategy extends BaseCacheWarmingStrategy {
  readonly name = "Custom";

  async warmup(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<CacheWarmingResult> {
    const keys = await provider.getWarmupKeys();
    // Custom warming logic
    return this.executeWarmup(cache, provider, keys);
  }

  getRecommendedKeys(): string[] {
    return ["recommended:key"];
  }
}
```

## Monitoring

### Warming Statistics

```typescript
const stats = cache.getWarmingStats();
console.log("Warming Statistics:", {
  strategies: stats.strategies,
  backgroundStatus: stats.backgroundStatus,
  adaptiveStats: stats.adaptiveStats,
});
```

### Recommended Keys

```typescript
const recommendations = cache.getRecommendedKeys();
for (const [strategy, keys] of recommendations) {
  console.log(`${strategy} recommends:`, keys);
}
```

## Performance Benefits

- **Reduced Cold Starts**: Pre-warmed cache eliminates initial cache misses
- **Improved Hit Rates**: Frequently accessed data is always available
- **Lower Latency**: Hot data served from memory/Redis
- **Adaptive Learning**: System learns and optimizes automatically
- **Background Processing**: Warming doesn't impact application performance

## Best Practices

1. **Start Simple**: Begin with static warming for known hot keys
2. **Monitor Performance**: Track hit rates and warming effectiveness
3. **Tune Intervals**: Adjust background warming intervals based on data patterns
4. **Resource Management**: Set appropriate limits for memory and concurrent operations
5. **Error Handling**: Implement proper error handling for warming failures

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Reduce `maxWarmupKeys` or increase TTL
2. **Slow Warming**: Increase `warmupBatchSize` or reduce concurrent operations
3. **Pattern Learning Not Working**: Ensure `enablePatternLearning` is true
4. **Background Warming Not Starting**: Check `enableBackgroundWarming` configuration

### Debug Information

```typescript
// Enable detailed logging
const cache = new CacheService(logger, redisClient, {
  // ... config
});

// Check warming status
console.log(cache.getWarmingStats());
console.log(cache.getRecommendedKeys());
```
