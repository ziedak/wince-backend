export interface Config {
  kafkaBrokers: string[];
  kafkaRawTopic: string;
  kafkaEnrichedTopic: string;
  kafkaDlqTopic: string;
  kafkaConsumerGroup: string;
  redisUrl: string;
  postgresUrl: string;
  bloomFilterKey: string;
  sessionTtlSeconds: number;
  maxPollRecords: number;
  commitIntervalMs: number;
  port: number;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): Config {
  return {
    kafkaBrokers: optional('KAFKA_BROKERS', 'kafka:29092').split(','),
    kafkaRawTopic: optional('KAFKA_RAW_TOPIC', 'raw.events'),
    kafkaEnrichedTopic: optional('KAFKA_ENRICHED_TOPIC', 'enriched.events'),
    kafkaDlqTopic: optional('KAFKA_DLQ_TOPIC', 'dead.letters'),
    kafkaConsumerGroup: optional('KAFKA_CONSUMER_GROUP', 'enrichment-group'),
    redisUrl: optional('REDIS_URL', 'redis://redis:6379'),
    postgresUrl: optional(
      'POSTGRES_PGBOUNCER',
      'postgresql://admin:password@pgbouncer:6432/app_db',
    ),
    bloomFilterKey: optional('BLOOM_FILTER_KEY', 'idem:bloom'),
    sessionTtlSeconds: parseInt(optional('SESSION_TTL_SECONDS', '1800'), 10),
    maxPollRecords: parseInt(optional('MAX_POLL_RECORDS', '500'), 10),
    commitIntervalMs: parseInt(optional('COMMIT_INTERVAL_MS', '5000'), 10),
    port: parseInt(optional('PORT', '3002'), 10),
  };
}
