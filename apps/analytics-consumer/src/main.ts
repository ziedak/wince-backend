import { ClickHouseClient } from '@org/clickhouse_client';
import { RedisClient } from '@org/redis_client';
import { createLogger } from '@org/logger';
import { loadConfig } from './config.js';
import { AnalyticsMetrics } from './metrics.js';
import { AnalyticsConsumer } from './consumer.js';
import { HealthServer } from './health.js';

const logger = createLogger({ service: 'analytics-consumer' });

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number.parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info(
    { topic: config.kafkaTopic, table: config.clickhouseTable, dedup: config.enableDedup },
    'Starting analytics-consumer',
  );

  const clickhouse = ClickHouseClient.create({
    url: config.clickhouseUrl,
    database: config.clickhouseDatabase,
    username: config.clickhouseUsername,
    password: config.clickhousePassword,
    requestTimeout: 30_000,
    maxOpenConnections: 10,
    compression: { response: true, request: false },
  });

  const redis = config.enableDedup
    ? RedisClient.create(parseRedisUrl(config.redisUrl))
    : null;

  const metrics = AnalyticsMetrics.create();
  const consumer = new AnalyticsConsumer(config, clickhouse, metrics, redis);
  const healthServer = new HealthServer(
    consumer.state,
    clickhouse,
    metrics,
    config.port,
    redis,
  );

  healthServer.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');
    await consumer.shutdown();
    await healthServer.stop();
    await clickhouse.disconnect().catch((err: unknown) => logger.error({ err }, 'ClickHouse disconnect error'));
    if (redis !== null) {
      await redis.disconnect().catch((err: unknown) => logger.error({ err }, 'Redis disconnect error'));
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  await consumer.start();
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal error during startup');
  process.exit(1);
});
