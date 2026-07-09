import { ClickHouseClient } from '@org/clickhouse_client';
import { createDb } from '@org/db';
import { RedisClient } from '@org/redis_client';
import { createLogger } from '@org/logger';
import { loadConfig } from './config.js';
import { AnalyticsConsumer } from './consumer.js';
import { HealthServer } from './health.js';
import { AnalyticsMetrics } from './metrics.js';

const logger = createLogger({ service: 'analytics-consumer' });

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info(
    { topic: config.kafkaTopic, table: config.clickhouseTable, port: config.port },
    'Starting analytics-consumer',
  );

  const metrics = AnalyticsMetrics.create();
  const db = createDb({ connectionString: config.postgresUrl });
  const redisClient = RedisClient.create(parseRedisUrl(config.redisUrl));
  const clickhouse = ClickHouseClient.create({
    url: config.clickhouseUrl,
    database: config.clickhouseDatabase,
    username: config.clickhouseUsername,
    password: config.clickhousePassword,
    requestTimeout: 30_000,
    maxOpenConnections: 10,
    compression: { response: true, request: false },
  });

  const consumer = new AnalyticsConsumer(config, clickhouse, metrics, redisClient, db);
  const healthServer = new HealthServer(
    consumer.state,
    clickhouse,
    metrics,
    config.port,
    config.enableDedup ? redisClient : null,
    db,
  );

  healthServer.start();

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down analytics-consumer');
    await consumer.shutdown();
    await healthServer.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());

  await consumer.start();
  logger.info(
    { group: config.kafkaConsumerGroup, topic: config.kafkaTopic },
    'Analytics consumer started',
  );
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exitCode = 1;
});
