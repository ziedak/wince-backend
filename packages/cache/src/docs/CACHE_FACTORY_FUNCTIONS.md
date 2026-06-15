# CacheService Factory Functions Guide

## Overview

The `CacheService` provides a comprehensive set of factory functions to create cache instances optimized for different use cases and environments. These factory methods simplify cache configuration and promote best practices.

## Factory Functions

### 1. **create()** - General Purpose Factory

```typescript
static create(
  metrics?: IMetricsCollector,
  caches?: ICache[],
  config: Partial<CacheConfig> = {}
): CacheService
```

**Purpose**: General-purpose factory with full customization options.

**Use Case**: When you need complete control over cache configuration.

**Example**:

```typescript
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";

const cache = CacheService.create(metricsCollector, undefined, {
  defaultTtl: 600,
  maxTtl: 3600,
  warmupOnStart: true,
});
```

---

### 2. **createMemoryOnly()** - Memory-Only Cache

```typescript
static createMemoryOnly(config: Partial<CacheConfig> = {}): CacheService
```

**Purpose**: Creates a cache service with only in-memory caching (no Redis).

**Use Case**:

- Unit testing
- Single-instance applications
- Development without Redis
- When Redis is unavailable

**Features**:

- ✅ Fast in-memory caching with LRU eviction
- ✅ 10,000 entry capacity
- ✅ No external dependencies
- ✅ Perfect for testing

**Example**:

```typescript
// Development without Redis
const cache = CacheService.createMemoryOnly({
  defaultTtl: 300,
  maxTtl: 600,
});

// Testing
const testCache = CacheService.createMemoryOnly();
```

**Performance**: Sub-millisecond reads/writes, no network latency

---

### 3. **createRedisOnly()** - Redis-Only Cache

```typescript
static createRedisOnly(
  metrics: IMetricsCollector,
  config: Partial<CacheConfig> = {}
): CacheService
```

**Purpose**: Creates a cache service with only Redis (no memory layer).

**Use Case**:

- Multi-instance deployments
- Shared cache across services
- When memory is limited
- Centralized cache management

**Features**:

- ✅ Shared cache across multiple instances
- ✅ Persistent caching
- ✅ Larger storage capacity
- ✅ Built-in metrics tracking

**Example**:

```typescript
import { metricsCollector } from "@libs/monitoring";

const cache = CacheService.createRedisOnly(metricsCollector, {
  defaultTtl: 600,
  maxTtl: 7200,
});
```

**Performance**: Network latency (~1-5ms), persistent storage

---

### 4. **createMultiLevel()** - Multi-Level Cache ⭐ Recommended

```typescript
static createMultiLevel(
  metrics: IMetricsCollector,
  config: Partial<CacheConfig> = {}
): CacheService
```

**Purpose**: Creates a two-level cache (Memory L1 + Redis L2).

**Use Case**:

- Production deployments
- High-performance requirements
- Best of both worlds approach

**Features**:

- ✅ Fast L1 memory cache (sub-ms)
- ✅ Shared L2 Redis cache (cross-instance)
- ✅ Automatic failover between levels
- ✅ Optimized hit rates

**Example**:

```typescript
import { metricsCollector } from "@libs/monitoring";

const cache = CacheService.createMultiLevel(metricsCollector, {
  defaultTtl: 300,
  maxTtl: 3600,
});

// Usage - transparent multi-level caching
const user = await cache.get<User>("user:123");
await cache.set("user:123", userData, 600);
```

**Performance**:

- L1 hits: < 1ms
- L2 hits: 1-5ms
- Typical hit rate: 85%+ L1, 95%+ combined

---

### 5. **createForDevelopment()** - Development Mode

```typescript
static createForDevelopment(
  metrics?: IMetricsCollector,
  config: Partial<CacheConfig> = {}
): CacheService
```

**Purpose**: Optimized for development environment.

**Use Case**:

- Local development
- Testing with realistic data
- Debugging cache behavior

**Features**:

- ✅ Cache warmup on startup
- ✅ Background warming every 10 minutes
- ✅ Pattern learning enabled
- ✅ Lower resource usage (50 warmup keys)
- ✅ Multi-level cache for realistic testing

**Example**:

```typescript
// Development setup
const cache = CacheService.createForDevelopment();

// With custom config
const cache = CacheService.createForDevelopment(metricsCollector, {
  defaultTtl: 600,
  warmingConfig: {
    maxWarmupKeys: 100,
  },
});
```

**Configuration**:

- Warmup on start: ✅ Enabled
- Background warming: Every 10 minutes
- Adaptive warming: ✅ Enabled
- Max warmup keys: 50

---

### 6. **createForProduction()** - Production Mode ⭐ Recommended

```typescript
static createForProduction(
  metrics: IMetricsCollector,
  config: Partial<CacheConfig> = {}
): CacheService
```

**Purpose**: Optimized for production environment.

**Use Case**:

- Production deployments
- High-availability requirements
- Performance-critical applications

**Features**:

- ✅ Multi-level cache (Memory + Redis)
- ✅ No startup blocking (warmup disabled)
- ✅ Background warming every 5 minutes
- ✅ Aggressive caching (1000 warmup keys)
- ✅ Extended TTLs (10 min default, 2 hour max)
- ✅ Full monitoring integration

**Example**:

```typescript
import { metricsCollector } from "@libs/monitoring";

const cache = CacheService.createForProduction(metricsCollector);

// With custom config
const cache = CacheService.createForProduction(metricsCollector, {
  defaultTtl: 1200, // 20 minutes
  maxTtl: 14400, // 4 hours
  warmingConfig: {
    maxWarmupKeys: 2000,
  },
});
```

**Configuration**:

- Default TTL: 10 minutes
- Max TTL: 2 hours
- Min TTL: 1 minute
- Warmup on start: ❌ Disabled (no blocking)
- Background warming: Every 5 minutes
- Max warmup keys: 1000
- Batch size: 50

---

### 7. **createForTesting()** - Testing Mode

```typescript
static createForTesting(config: Partial<CacheConfig> = {}): CacheService
```

**Purpose**: Optimized for unit and integration tests.

**Use Case**:

- Jest/Mocha unit tests
- Integration tests
- CI/CD pipelines

**Features**:

- ✅ Memory-only (no Redis dependency)
- ✅ No warmup (fast startup)
- ✅ No background processes
- ✅ Predictable behavior
- ✅ Easy cleanup

**Example**:

```typescript
describe("CacheService Tests", () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = CacheService.createForTesting();
  });

  afterEach(async () => {
    await cache.dispose();
  });

  it("should cache data", async () => {
    await cache.set("test-key", "test-value", 60);
    const result = await cache.get("test-key");
    expect(result.data).toBe("test-value");
  });
});
```

**Configuration**:

- Cache type: Memory-only
- Warmup: ❌ Disabled
- Background warming: ❌ Disabled
- Pattern learning: ❌ Disabled

---

### 8. **createHighThroughput()** - High-Performance Mode

```typescript
static createHighThroughput(
  metrics: IMetricsCollector,
  config: Partial<CacheConfig> = {}
): CacheService
```

**Purpose**: Optimized for high-traffic applications.

**Use Case**:

- High-traffic APIs
- Real-time applications
- Performance-critical systems

**Features**:

- ✅ Large memory buffer (50,000 entries)
- ✅ Extended TTLs (30 min default, 4 hour max)
- ✅ Aggressive warmup (2000 keys)
- ✅ Fast background warming (3 minutes)
- ✅ Large batch operations (100 per batch)

**Example**:

```typescript
import { metricsCollector } from "@libs/monitoring";

const cache = CacheService.createHighThroughput(metricsCollector);

// Handles high request volumes efficiently
const users = await cache.mGet(userIds); // Batch operations
await cache.mSet(userData, 1800); // 30 min cache
```

**Configuration**:

- Memory cache size: 50,000 entries
- Default TTL: 30 minutes
- Max TTL: 4 hours
- Min TTL: 5 minutes
- Max warmup keys: 2000
- Batch size: 100
- Background warming: Every 3 minutes

**Performance**: Optimized for 10,000+ req/sec

---

### 9. **createWithCustomCaches()** - Custom Implementation

```typescript
static createWithCustomCaches(
  caches: ICache[],
  metrics?: IMetricsCollector,
  config: Partial<CacheConfig> = {}
): CacheService
```

**Purpose**: Create cache with custom implementations.

**Use Case**:

- Custom cache strategies
- Third-party cache integrations
- Specialized caching needs

**Example**:

```typescript
import { MyCustomCache } from "./custom-cache";

const customCache = new MyCustomCache(config);
const anotherCache = new AnotherCache(config);

const cache = CacheService.createWithCustomCaches(
  [customCache, anotherCache],
  metricsCollector,
  { defaultTtl: 600 }
);
```

**Validation**: Throws error if no caches provided

---

## Comparison Matrix

| Factory                    | Memory  | Redis  | Multi-Level | Warmup | Best For       |
| -------------------------- | ------- | ------ | ----------- | ------ | -------------- |
| `create()`                 | ✓       | ✓      | ✓           | Custom | Full control   |
| `createMemoryOnly()`       | ✓       | ❌     | ❌          | ❌     | Testing, Dev   |
| `createRedisOnly()`        | ❌      | ✓      | ❌          | ❌     | Multi-instance |
| `createMultiLevel()`       | ✓       | ✓      | ✓           | ❌     | Production     |
| `createForDevelopment()`   | ✓       | ✓      | ✓           | ✓      | Development    |
| `createForProduction()`    | ✓       | ✓      | ✓           | ✓      | Production     |
| `createForTesting()`       | ✓       | ❌     | ❌          | ❌     | Tests          |
| `createHighThroughput()`   | ✓ (50k) | ✓      | ✓           | ✓      | High traffic   |
| `createWithCustomCaches()` | Custom  | Custom | Custom      | Custom | Custom needs   |

## Usage Patterns

### Pattern 1: Simple Setup

```typescript
// Development
const devCache = CacheService.createForDevelopment();

// Production
const prodCache = CacheService.createForProduction(metrics);
```

### Pattern 2: Environment-Based

```typescript
import { getEnv } from "@libs/config";
import { metricsCollector } from "@libs/monitoring";

function createCache(): CacheService {
  const env = getEnv("NODE_ENV", "development");

  switch (env) {
    case "production":
      return CacheService.createForProduction(metricsCollector);
    case "test":
      return CacheService.createForTesting();
    default:
      return CacheService.createForDevelopment();
  }
}

export const cache = createCache();
```

### Pattern 3: Custom Configuration

```typescript
const cache = CacheService.createForProduction(metrics, {
  defaultTtl: 1200, // 20 minutes
  maxTtl: 7200, // 2 hours
  warmingConfig: {
    maxWarmupKeys: 500,
    backgroundWarmingInterval: 600, // 10 minutes
  },
});
```

### Pattern 4: Testing Setup

```typescript
describe("My Service Tests", () => {
  let cache: CacheService;

  beforeAll(() => {
    cache = CacheService.createForTesting();
  });

  afterAll(async () => {
    await cache.dispose();
  });

  // Tests...
});
```

## Best Practices

### 1. Use Appropriate Factory

```typescript
// ✅ Good - Use specific factory
const cache = CacheService.createForProduction(metrics);

// ❌ Avoid - Generic factory with manual config
const cache = CacheService.create(metrics, undefined, {
  defaultTtl: 600,
  maxTtl: 7200,
  warmupOnStart: false,
  // ... lots of config
});
```

### 2. Environment Detection

```typescript
// ✅ Good - Auto-detect environment
const cache =
  process.env.NODE_ENV === "production"
    ? CacheService.createForProduction(metrics)
    : CacheService.createForDevelopment();
```

### 3. Proper Cleanup

```typescript
// ✅ Good - Always dispose
const cache = CacheService.createForProduction(metrics);

process.on("SIGTERM", async () => {
  await cache.dispose();
  process.exit(0);
});
```

### 4. Custom Requirements

```typescript
// ✅ Good - Start with base factory, customize as needed
const cache = CacheService.createForProduction(metrics, {
  defaultTtl: 1800, // Custom TTL
  warmingConfig: {
    maxWarmupKeys: 2000, // Custom warmup
  },
});
```

## Performance Characteristics

### Memory-Only

- **Read**: < 1ms
- **Write**: < 1ms
- **Capacity**: 10,000 entries (configurable)
- **Persistence**: None

### Redis-Only

- **Read**: 1-5ms
- **Write**: 1-5ms
- **Capacity**: Limited by Redis memory
- **Persistence**: Yes (Redis)

### Multi-Level

- **Read (L1 hit)**: < 1ms
- **Read (L2 hit)**: 1-5ms
- **Write**: 1-10ms (both levels)
- **Hit Rate**: 85-95%+
- **Capacity**: 10,000 (L1) + unlimited (L2)

### High-Throughput

- **Read (L1 hit)**: < 1ms
- **Read (L2 hit)**: 1-5ms
- **Capacity**: 50,000 (L1) + unlimited (L2)
- **Throughput**: 10,000+ req/sec

## Migration Guide

### From Manual Configuration

```typescript
// Before
const cache = new CacheService(
  metrics,
  [new MemoryCache(), new RedisCache(redisClient)],
  {
    defaultTtl: 600,
    // ... complex config
  }
);

// After
const cache = CacheService.createForProduction(metrics);
```

### From Basic Create

```typescript
// Before
const cache = CacheService.create(metrics);

// After - More explicit and optimized
const cache = CacheService.createForProduction(metrics);
```

## Factory Function Decision Tree

```
Need cache?
├─ Testing? → createForTesting()
├─ Development? → createForDevelopment()
├─ Production?
│  ├─ High traffic? → createHighThroughput()
│  ├─ Single instance? → createMemoryOnly() or createRedisOnly()
│  └─ Standard? → createForProduction()
└─ Custom needs? → createWithCustomCaches()
```

## Summary

The factory functions provide:

- ✅ **Simplified Setup** - No complex configuration needed
- ✅ **Best Practices** - Pre-configured for common scenarios
- ✅ **Type Safety** - Full TypeScript support
- ✅ **Performance** - Optimized for each use case
- ✅ **Flexibility** - Override any setting as needed

**Recommended**: Use `createForProduction()` for production and `createForTesting()` for tests. Override specific settings only when needed.
