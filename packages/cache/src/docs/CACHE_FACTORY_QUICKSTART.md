# CacheService Factory - Quick Reference

## Quick Start Examples

### Development Setup

```typescript
import { CacheService } from "@libs/database";

// Simple - auto-configured for dev
const cache = CacheService.createForDevelopment();
```

### Production Setup

```typescript
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";

// Production-ready with monitoring
const cache = CacheService.createForProduction(metricsCollector);
```

### Testing Setup

```typescript
import { CacheService } from "@libs/database";

// Unit tests - no Redis required
const cache = CacheService.createForTesting();
```

## Common Scenarios

### Scenario 1: REST API Service

```typescript
// apps/api-gateway/src/cache.ts
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";
import { getEnv } from "@libs/config";

export const cacheService =
  getEnv("NODE_ENV") === "production"
    ? CacheService.createForProduction(metricsCollector)
    : CacheService.createForDevelopment(metricsCollector);
```

### Scenario 2: High-Traffic API

```typescript
// apps/api-gateway/src/cache.ts
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";

// Optimized for high request volume
export const cacheService = CacheService.createHighThroughput(
  metricsCollector,
  {
    defaultTtl: 1800, // 30 minutes
    maxTtl: 14400, // 4 hours
  }
);
```

### Scenario 3: Microservice (Multi-Instance)

```typescript
// apps/ai-engine/src/cache.ts
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";

// Redis-only for shared cache across instances
export const cacheService = CacheService.createRedisOnly(metricsCollector, {
  defaultTtl: 600,
  maxTtl: 3600,
});
```

### Scenario 4: Standalone Service (No Redis)

```typescript
// apps/dashboard/src/cache.ts
import { CacheService } from "@libs/database";

// Memory-only for single instance
export const cacheService = CacheService.createMemoryOnly({
  defaultTtl: 300,
  maxTtl: 1800,
});
```

### Scenario 5: Environment-Based Configuration

```typescript
// libs/database/src/cache/factory.ts
import { CacheService } from "./cache.service";
import { metricsCollector } from "@libs/monitoring";
import { getEnv } from "@libs/config";

export function createEnvironmentCache(): CacheService {
  const env = getEnv("NODE_ENV", "development");

  switch (env) {
    case "production":
      return CacheService.createForProduction(metricsCollector);

    case "staging":
      return CacheService.createMultiLevel(metricsCollector, {
        defaultTtl: 600,
        warmingConfig: {
          maxWarmupKeys: 500,
        },
      });

    case "test":
      return CacheService.createForTesting();

    default:
      return CacheService.createForDevelopment(metricsCollector);
  }
}

export const cache = createEnvironmentCache();
```

## Usage After Creation

### Basic Operations

```typescript
// Get from cache
const user = await cache.get<User>("user:123");
if (user.data) {
  console.log("Cache hit:", user.data);
}

// Set in cache
await cache.set("user:123", userData, 600);

// Check existence
const exists = await cache.exists("user:123");

// Invalidate
await cache.invalidate("user:123");
```

### Advanced Operations

```typescript
// Batch operations
const users = await cache.mGet<User>(["user:1", "user:2", "user:3"]);
await cache.mSet(
  {
    "user:1": userData1,
    "user:2": userData2,
    "user:3": userData3,
  },
  600
);

// Counter operations
const views = await cache.increment("page:home:views");
const likes = await cache.increment("post:123:likes", 5);

// Compute pattern
const report = await cache.getOrCompute(
  "report:monthly",
  async () => await generateReport(),
  86400 // 24 hours
);

// Pattern invalidation
await cache.invalidatePattern("user:*");
await cache.mInvalidate(["session", "auth", "profile"]);
```

## Integration Examples

### Express Middleware

```typescript
import express from "express";
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";

const app = express();
const cache = CacheService.createForProduction(metricsCollector);

// Cache middleware
app.use(async (req, res, next) => {
  const cacheKey = `http:${req.method}:${req.path}`;
  const cached = await cache.get(cacheKey);

  if (cached.data) {
    return res.json(cached.data);
  }

  // Store original send
  const originalSend = res.json.bind(res);
  res.json = (data: any) => {
    cache.set(cacheKey, data, 300).catch(console.error);
    return originalSend(data);
  };

  next();
});

// Cleanup on shutdown
process.on("SIGTERM", async () => {
  await cache.dispose();
  process.exit(0);
});
```

### Elysia.js Plugin

```typescript
import { Elysia } from "elysia";
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";

const cache = CacheService.createForProduction(metricsCollector);

export const cachePlugin = new Elysia({ name: "cache" })
  .decorate("cache", cache)
  .onStop(async () => {
    await cache.dispose();
  });

// Usage in routes
app.use(cachePlugin).get("/users/:id", async ({ params, cache }) => {
  const cacheKey = `user:${params.id}`;

  const cached = await cache.get(cacheKey);
  if (cached.data) {
    return cached.data;
  }

  const user = await fetchUser(params.id);
  await cache.set(cacheKey, user, 600);

  return user;
});
```

### Repository Pattern

```typescript
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";

export class UserRepository {
  private cache = CacheService.createForProduction(metricsCollector);

  async findById(id: string): Promise<User | null> {
    return this.cache.getOrCompute(
      `user:${id}`,
      async () => {
        // Fetch from database
        return await this.db.user.findUnique({ where: { id } });
      },
      600 // 10 minutes
    );
  }

  async save(user: User): Promise<void> {
    await this.db.user.update({
      where: { id: user.id },
      data: user,
    });

    // Invalidate cache
    await this.cache.invalidate(`user:${user.id}`);
  }

  async dispose(): Promise<void> {
    await this.cache.dispose();
  }
}
```

### Testing Setup

```typescript
// user.service.test.ts
import { CacheService } from "@libs/database";
import { UserService } from "./user.service";

describe("UserService", () => {
  let cache: CacheService;
  let service: UserService;

  beforeEach(() => {
    cache = CacheService.createForTesting();
    service = new UserService(cache);
  });

  afterEach(async () => {
    await cache.dispose();
  });

  it("should cache user data", async () => {
    const user = { id: "1", name: "Test" };
    await service.saveUser(user);

    const cached = await cache.get("user:1");
    expect(cached.data).toEqual(user);
  });

  it("should invalidate on update", async () => {
    const user = { id: "1", name: "Test" };
    await cache.set("user:1", user, 300);

    await service.updateUser({ ...user, name: "Updated" });

    const cached = await cache.get("user:1");
    expect(cached.data).toBeNull();
  });
});
```

## Docker Compose Configuration

### Development

```yaml
# docker-compose.dev.yml
services:
  api-gateway:
    environment:
      NODE_ENV: development
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

### Production

```yaml
# docker-compose.prod.yml
services:
  api-gateway:
    environment:
      NODE_ENV: production
      REDIS_HOST: redis-cluster
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
    depends_on:
      - redis-cluster

  redis-cluster:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 2gb

volumes:
  redis-data:
```

## Environment Variables

```bash
# .env.development
NODE_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379

# .env.production
NODE_ENV=production
REDIS_HOST=redis-cluster.internal
REDIS_PORT=6379
REDIS_PASSWORD=secure-password
REDIS_TLS=true
```

## Monitoring Integration

```typescript
import { CacheService } from "@libs/database";
import { metricsCollector } from "@libs/monitoring";

const cache = CacheService.createForProduction(metricsCollector);

// Expose metrics endpoint
app.get("/metrics/cache", async (req, res) => {
  const stats = cache.getStats();
  const health = await cache.healthCheck();

  res.json({
    stats,
    health,
    warmingStats: cache.getWarmingStats(),
  });
});

// Prometheus metrics
app.get("/metrics", async (req, res) => {
  const stats = cache.getStats();

  res.set("Content-Type", "text/plain");
  res.send(`
    # HELP cache_hits_total Total cache hits
    # TYPE cache_hits_total counter
    cache_hits_total ${stats.Hits}
    
    # HELP cache_misses_total Total cache misses
    # TYPE cache_misses_total counter
    cache_misses_total ${stats.Misses}
    
    # HELP cache_hit_rate Current cache hit rate
    # TYPE cache_hit_rate gauge
    cache_hit_rate ${stats.hitRate}
    
    # HELP cache_memory_usage Memory usage in bytes
    # TYPE cache_memory_usage gauge
    cache_memory_usage ${stats.memoryUsage}
  `);
});
```

## Quick Decision Guide

```
Choose factory based on:

Testing?
  → CacheService.createForTesting()

Development?
  → CacheService.createForDevelopment()

Production?
  ├─ High traffic (10k+ req/sec)?
  │   → CacheService.createHighThroughput(metrics)
  │
  ├─ Multiple instances?
  │   → CacheService.createRedisOnly(metrics)
  │
  └─ Standard production?
      → CacheService.createForProduction(metrics)

Custom requirements?
  → CacheService.createWithCustomCaches(caches, metrics, config)
```

## Common Mistakes to Avoid

### ❌ Don't: Forget to dispose

```typescript
const cache = CacheService.createForProduction(metrics);
// App crashes without cleanup
```

### ✅ Do: Always dispose on shutdown

```typescript
const cache = CacheService.createForProduction(metrics);

process.on("SIGTERM", async () => {
  await cache.dispose();
  process.exit(0);
});
```

### ❌ Don't: Create cache in every request

```typescript
app.get("/users", async (req, res) => {
  const cache = CacheService.createForProduction(metrics); // ❌ Wrong!
  // ...
});
```

### ✅ Do: Create once, reuse everywhere

```typescript
const cache = CacheService.createForProduction(metrics);

app.get("/users", async (req, res) => {
  // Use existing cache instance
  const users = await cache.get("users");
  // ...
});
```

### ❌ Don't: Use wrong factory for environment

```typescript
// In production
const cache = CacheService.createForTesting(); // ❌ No Redis!
```

### ✅ Do: Use environment-appropriate factory

```typescript
const cache =
  process.env.NODE_ENV === "production"
    ? CacheService.createForProduction(metrics)
    : CacheService.createForDevelopment();
```

---

**Quick Tip**: Start with `createForProduction()` or `createForDevelopment()` and only customize if you have specific requirements.
