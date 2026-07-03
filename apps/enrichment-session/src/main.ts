import { createLogger } from '@org/logger';
import { RedisClient } from '@org/redis_client';
import { createDb, type Pool } from '@org/db';
import { loadConfig } from './config.js';
import { EnrichmentMetrics } from './metrics.js';
import { IdempotencyService } from './idempotency.js';
import { SessionService } from './session.js';
import { CustomerService } from './customer.js';
import { Enricher } from './enricher.js';
import { TriggerForwarder } from './trigger-forwarder.js';
import { EnrichmentConsumer } from './consumer.js';
import { HealthServer } from './health.js';

const logger = createLogger({ service: 'enrichment-session' });

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
  logger.info('Starting enrichment-session service');

  const redis = RedisClient.create(parseRedisUrl(config.redisUrl));
  const db = createDb({ connectionString: config.postgresUrl, max: 10 });

  const metrics = new EnrichmentMetrics();
  const idempotency = new IdempotencyService(redis, db, config.bloomFilterKey, metrics);
  const session = new SessionService(redis, config.sessionTtlSeconds);
  const customer = new CustomerService(redis, db, metrics);
  const enricher = new Enricher(idempotency, session, customer, metrics, logger);
  const triggerForwarder = new TriggerForwarder(config.decisionEngineUrl, config.internalSecret);
  const consumer = new EnrichmentConsumer(config, enricher, idempotency, metrics, triggerForwarder);
  const healthServer = new HealthServer(consumer.state, redis, db, metrics, config.port);

  healthServer.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');
    await consumer.shutdown();
    await healthServer.stop();
    await redis.disconnect();
    await (db.$client as Pool).end();
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
