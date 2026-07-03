import { Hono } from 'hono';
import type { DbClient } from './types';
import type { RedisClient } from '@org/redis_client';
import type { ClickHouseClient } from '@org/clickhouse_client';

export function createHealthRouter(db: DbClient, redis: RedisClient, ch: ClickHouseClient) {
  const app = new Hono();

  app.get('/live', (c) => c.text('ok'));

  app.get('/ready', async (c) => {
    const checks: Record<string, boolean> = { postgres: false, redis: false, clickhouse: false };

    try {
      await db.execute('SELECT 1' as unknown as Parameters<typeof db.execute>[0]);
      checks.postgres = true;
    } catch { /* unhealthy */ }

    try {
      const pong = await redis.getRedis().ping();
      checks.redis = pong === 'PONG';
    } catch { /* unhealthy */ }

    try {
      checks.clickhouse = await ch.ping();
    } catch { /* unhealthy */ }

    const allHealthy = Object.values(checks).every(Boolean);
    return c.json({ status: allHealthy ? 'ok' : 'degraded', checks }, allHealthy ? 200 : 503);
  });

  return app;
}
