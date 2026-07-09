export interface Config {
  // Kafka consumer
  kafkaBrokers: string[];
  kafkaClientId: string;
  kafkaConsumerGroup: string;
  kafkaTopic: string;
  kafkaDlqTopic: string;
  // Kafka admin (lag polling)
  kafkaAdminClientId: string;
  // ClickHouse
  clickhouseUrl: string;
  clickhouseDatabase: string;
  clickhouseUsername: string;
  clickhousePassword: string;
  clickhouseTable: string;
  clickhouseInterventionEventsTable: string;
  // PostgreSQL (intervention lifecycle events — $intervention_shown/clicked/etc.)
  postgresUrl: string;
  // Batching
  batchSize: number;
  batchTimeoutMs: number;
  // Dedup via Redis bloom filter
  enableDedup: boolean;
  redisUrl: string;
  bloomFilterKey: string;
  // Retry / resilience
  maxRetries: number;
  retryBaseDelayMs: number;
  // HTTP health port
  port: number;
  // Consumer group lag poll interval
  lagPollIntervalMs: number;
  // Periodic Kafka-vs-ClickHouse row-count reconciliation check
  reconciliationIntervalMs: number;
  reconciliationToleranceRatio: number;
}

export function loadConfig(): Config {
  // KAFKA_HOSTS matches the env var name used by every other TS service
  // (ingestion, decision-engine, notification-service) — KAFKA_BROKERS was
  // a naming drift unique to this service.
  const brokers = (process.env['KAFKA_HOSTS'] ?? 'kafka:29092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  return {
    kafkaBrokers: brokers,
    kafkaClientId: process.env['KAFKA_CLIENT_ID'] ?? 'analytics-consumer',
    kafkaConsumerGroup: process.env['KAFKA_GROUP_ID'] ?? 'analytics-consumer-group',
    kafkaTopic: process.env['KAFKA_TOPIC'] ?? 'enriched.events',
    // 'dead.letters' is the shared DLQ topic already created by init-kafka
    // and used by decision-engine — analytics.dlq was never provisioned.
    kafkaDlqTopic: process.env['KAFKA_DLQ_TOPIC'] ?? 'dead.letters',
    kafkaAdminClientId: process.env['KAFKA_ADMIN_CLIENT_ID'] ?? 'analytics-consumer-admin',
    clickhouseUrl: process.env['CLICKHOUSE_URL'] ?? 'http://clickhouse:8123',
    clickhouseDatabase: process.env['CLICKHOUSE_DATABASE'] ?? 'default',
    clickhouseUsername: process.env['CLICKHOUSE_USERNAME'] ?? 'default',
    clickhousePassword: process.env['CLICKHOUSE_PASSWORD'] ?? '',
    clickhouseTable: process.env['CLICKHOUSE_TABLE'] ?? 'events',
    clickhouseInterventionEventsTable:
      process.env['CLICKHOUSE_INTERVENTION_EVENTS_TABLE'] ?? 'intervention_events',
    postgresUrl:
      process.env['POSTGRES_URL'] ?? 'postgresql://admin:password@pgbouncer:6432/app_db',
    batchSize: Number.parseInt(process.env['BATCH_SIZE'] ?? '10000', 10),
    batchTimeoutMs: Number.parseInt(process.env['BATCH_TIMEOUT_MS'] ?? '5000', 10),
    enableDedup: process.env['ENABLE_DEDUP'] === 'true',
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    bloomFilterKey: process.env['BLOOM_FILTER_KEY'] ?? 'analytics:dedup',
    maxRetries: Number.parseInt(process.env['MAX_RETRIES'] ?? '3', 10),
    // 3 attempts, exponential backoff: 100ms, 200ms, 400ms (per docs/services/Analytics Consumer.md §3.3)
    retryBaseDelayMs: Number.parseInt(process.env['RETRY_BASE_DELAY_MS'] ?? '100', 10),
    port: Number.parseInt(process.env['PORT'] ?? '3009', 10),
    lagPollIntervalMs: Number.parseInt(process.env['LAG_POLL_INTERVAL_MS'] ?? '30000', 10),
    reconciliationIntervalMs: Number.parseInt(
      process.env['RECONCILIATION_INTERVAL_MS'] ?? '300000',
      10,
    ),
    reconciliationToleranceRatio: Number.parseFloat(
      process.env['RECONCILIATION_TOLERANCE_RATIO'] ?? '0.01',
    ),
  };
}
