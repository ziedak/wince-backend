import * as ort from 'onnxruntime-node'
import { CacheService } from '@org/cache'
import { ClickHouseClient } from '@org/clickhouse_client'
import type { IClickHouseConfig } from '@org/clickhouse_client'
import { createDb } from '@org/db'
import { createProducerClient } from '@org/kafka_client'
import { createLogger } from '@org/logger'
import { OnnxRuntime, type OrtBackend } from '@org/onnx-runtime'
import { RedisClient } from '@org/redis_client'
import { loadConfig } from './config'
import { HealthServer } from './health'
import { InternalHandler } from './internal/internal-handler'
import { InterventionWriter } from './intervention/intervention.writer'
import { DecisionConsumer } from './kafka/decision.consumer'
import { DecisionMetrics } from './metrics'
import { SchedulerWorker } from './scheduler/scheduler.worker'
import {
  PolicyService,
  CooldownService,
  BudgetService,
  FeatureService,
  RuleEngine,
  InferenceService,
  ExperimentService,
  DiscountService,
  RiskScorerService,
  LockService,
  SessionFeaturesService,
  OutboundService,
  DecisionOrchestrator,
  StaleScannerService,
  PredictionService,
  RecommendationService,
} from './services'
import { SchedulerService } from './services/scheduler.service'
import { TriggerHandler } from './trigger/trigger.handler'

const logger = createLogger({ service: 'decision-engine' })

function parseRedisUrl(url: string): {
  host: string
  port: number
  password?: string
} {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  }
}

function buildClickHouseConfig(url: string): IClickHouseConfig {
  const parsed = new URL(url)
  return {
    url,
    username: parsed.username || 'default',
    password: parsed.password || '',
    database: parsed.pathname.replace('/', '') || 'default',
    requestTimeout: 30_000,
    maxOpenConnections: 10,
    compression: { response: true, request: false },
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  logger.info({ port: config.port }, 'Starting decision-engine')

  const metrics = new DecisionMetrics()

  // ── Infrastructure ───────────────────────────────────────────────────────
  const db = createDb({ connectionString: config.postgresUrl })
  const redisClient = RedisClient.create(parseRedisUrl(config.redisUrl))
  const cache = CacheService.createMultiLevel(redisClient)
  const clickhouse = new ClickHouseClient(
    buildClickHouseConfig(config.clickhouseUrl)
  )

  // ── Leaf services (no inter-service deps) ────────────────────────────────
  const policy = new PolicyService(db, cache)
  const cooldown = new CooldownService(redisClient)
  const budget = new BudgetService(db, redisClient)
  const features = new FeatureService(clickhouse, cache, metrics)
  const rules = new RuleEngine()
  const runtime = OnnxRuntime.create({ backend: ort as unknown as OrtBackend })
  const inference = InferenceService.from(runtime, config.modelPath, metrics)
  const experiment = new ExperimentService(db, cache)
  const discount = new DiscountService(db)

  // ── Phase 1: Risk scoring + concurrency guards ───────────────────────────
  const riskScorer = new RiskScorerService(
    rules,
    inference,
    redisClient,
    metrics
  )
  const lock = new LockService(redisClient, metrics)
  const scheduler = new SchedulerService(redisClient)
  const sessionFeatures = new SessionFeaturesService(redisClient)

  // ── Phase 2: Delivery ────────────────────────────────────────────────────
  const outbound = new OutboundService(config, metrics)

  const producer = createProducerClient({
    brokers: config.kafkaBrokers,
    clientId: 'decision-engine-writer',
  })

  const writer = new InterventionWriter(
    db,
    producer,
    config.kafkaTopicInterventionLog,
    config.kafkaTopicDlq,
    metrics
  )

  // ── Prediction + Recommendation services ─────────────────────────────────
  const prediction = new PredictionService(runtime, config.predictionModelPath, metrics)
  const recommendation = new RecommendationService(
    db,
    redisClient,
    producer,
    config.kafkaTopicRecommendations,
    metrics
  )

  // ── Orchestrator + fast-path ─────────────────────────────────────────────
  const orchestrator = new DecisionOrchestrator(
    policy,
    cooldown,
    budget,
    features,
    riskScorer,
    experiment,
    discount,
    outbound,
    writer,
    metrics,
    lock,
    scheduler,
    prediction,
    recommendation,
    sessionFeatures
  )

  const triggerHandler = new TriggerHandler(
    orchestrator,
    config.internalSecret,
    sessionFeatures
  )
  const internalHandler = new InternalHandler(
    orchestrator,
    sessionFeatures,
    config.internalSecret
  )

  // Create consumer before HealthServer so its state ref can be passed for /ready checks.
  const consumer = new DecisionConsumer(
    config,
    orchestrator,
    metrics,
    lock,
    scheduler
  )

  const healthServer = new HealthServer(
    metrics,
    config.port,
    triggerHandler,
    redisClient,
    consumer.state,
    internalHandler
  )

  // ── Background workers ───────────────────────────────────────────────────
  const schedulerWorker = new SchedulerWorker(
    scheduler,
    sessionFeatures,
    orchestrator
  )
  const staleScanner = new StaleScannerService(
    redisClient,
    sessionFeatures,
    orchestrator,
    lock,
    features,
    db
  )

  healthServer.start()
  logger.info({ port: config.port }, 'Health server listening')

  schedulerWorker.start()
  staleScanner.start()

  await consumer.start()
  logger.info(
    { group: config.kafkaGroupId, topic: config.kafkaTopicEnriched },
    'Decision consumer started'
  )

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down decision-engine')
    schedulerWorker.stop()
    staleScanner.stop()
    await consumer.shutdown()
    await producer.shutdown()
    healthServer.stop()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error')
  process.exit(1)
})
