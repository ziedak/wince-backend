import { createLogger } from '@org/logger';
import { createDb } from '@org/db';
import { RedisClient } from '@org/redis_client';
import { CacheService } from '@org/cache';
import { createProducerClient } from '@org/kafka_client';
import { ClickHouseClient } from '@org/clickhouse_client';
import type { IClickHouseConfig } from '@org/clickhouse_client';
import { loadConfig } from './config.js';
import { DecisionMetrics } from './metrics.js';
import { HealthServer } from './health.js';
import { PolicyService } from './policy/policy.service.js';
import { CooldownService } from './cooldown/cooldown.service.js';
import { BudgetService } from './budget/budget.service.js';
import { FeatureService } from './features/features.service.js';
import { RuleEngine } from './rules/rules.service.js';
import { InferenceService } from './inference/inference.service.js';
import { ExperimentService } from './experiment/experiment.service.js';
import { DiscountService } from './discount/discount.service.js';
import { OutboundService } from './outbound/outbound.service.js';
import { InterventionWriter } from './intervention/intervention.writer.js';
import { DecisionOrchestrator } from './intervention/intervention.service.js';
import { DecisionConsumer } from './kafka/decision.consumer.js';

const logger = createLogger({ service: 'decision-engine' });

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

function buildClickHouseConfig(url: string): IClickHouseConfig {
  const parsed = new URL(url);
  return {
    url,
    username: parsed.username || 'default',
    password: parsed.password || '',
    database: parsed.pathname.replace('/', '') || 'default',
    requestTimeout: 30_000,
    maxOpenConnections: 10,
    compression: { response: true, request: false },
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ port: config.port }, 'Starting decision-engine');

  const metrics = new DecisionMetrics();
  const healthServer = new HealthServer(metrics, config.port);

  // ── Infrastructure ───────────────────────────────────────────────────────
  const db = createDb({ connectionString: config.postgresUrl });
  const redisClient = RedisClient.create(parseRedisUrl(config.redisUrl));
  const cache = CacheService.createMultiLevel(redisClient);
  const clickhouse = new ClickHouseClient(buildClickHouseConfig(config.clickhouseUrl));

  // ── Phase B services ─────────────────────────────────────────────────────
  const policy = new PolicyService(db, cache);
  const cooldown = new CooldownService(redisClient);
  const budget = new BudgetService(db, redisClient);
  const features = new FeatureService(clickhouse, cache, metrics);
  const rules = new RuleEngine();
  const inference = new InferenceService(config.modelPath, metrics);
  const experiment = new ExperimentService(db, cache);
  const discount = new DiscountService(db);

  // ── Phase C services ─────────────────────────────────────────────────────
  const outbound = new OutboundService(config, metrics);

  const producer = createProducerClient({
    brokers: config.kafkaBrokers,
    clientId: 'decision-engine-writer',
  });

  const writer = new InterventionWriter(
    db,
    producer,
    config.kafkaTopicInterventionLog,
    config.kafkaTopicDlq,
    metrics,
  );

  const orchestrator = new DecisionOrchestrator(
    policy,
    cooldown,
    budget,
    features,
    rules,
    inference,
    experiment,
    discount,
    outbound,
    writer,
    metrics,
  );

  const consumer = new DecisionConsumer(config, orchestrator, metrics);

  healthServer.start();
  logger.info({ port: config.port }, 'Health server listening');

  await consumer.start();
  logger.info({ group: config.kafkaGroupId, topic: config.kafkaTopicEnriched }, 'Decision consumer started');

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down decision-engine');
    await consumer.shutdown();
    await producer.shutdown();
    healthServer.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
