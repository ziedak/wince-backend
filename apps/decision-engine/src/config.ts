export interface Config {
  port: number;
  kafkaBrokers: string[];
  kafkaTopicEnriched: string;
  kafkaTopicInterventionLog: string;
  kafkaTopicDlq: string;
  kafkaGroupId: string;
  redisUrl: string;
  postgresUrl: string;
  clickhouseUrl: string;
  /** Internal secret shared with intervention-gateway and notification-service */
  internalSecret: string;
  /** Base URL for intervention-gateway (Docker network direct — bypasses Kong) */
  gatewayUrl: string;
  /** Base URL for notification-service (Docker network direct — bypasses Kong) */
  notificationUrl: string;
  /** Absolute path to ONNX risk-scoring model; omit to return stub confidence and use rules only */
  modelPath: string | undefined;
  /** Absolute path to ONNX prediction model (future abandonment probability); omit for stub */
  predictionModelPath: string | undefined;
  /** Kafka topic for intervention recommendation events (audit + async fan-out) */
  kafkaTopicRecommendations: string;
  logLevel: string;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] ?? '3007', 10),
    kafkaBrokers: optional('KAFKA_HOSTS', 'kafka:29092').split(','),
    kafkaTopicEnriched: optional('KAFKA_TOPIC_ENRICHED', 'enriched.events'),
    kafkaTopicInterventionLog: optional('KAFKA_TOPIC_INTERVENTION_LOG', 'intervention.log'),
    kafkaTopicDlq: optional('KAFKA_TOPIC_DLQ', 'dead.letters'),
    kafkaGroupId: optional('KAFKA_GROUP_ID', 'decision-group'),
    redisUrl: optional('REDIS_URL', 'redis://redis:6379'),
    postgresUrl: optional('POSTGRES_URL', 'postgresql://admin:password@pgbouncer:6432/app_db'),
    clickhouseUrl: optional('CLICKHOUSE_URL', 'http://clickhouse:8123'),
    internalSecret: optional('INTERNAL_SECRET', 'dev-internal-secret'),
    gatewayUrl: optional('GATEWAY_URL', 'http://intervention-gateway:3005'),
    notificationUrl: optional('NOTIFICATION_URL', 'http://notification-service:3006'),
    modelPath: process.env['MODEL_PATH'],
    predictionModelPath: process.env['PREDICTION_MODEL_PATH'],
    kafkaTopicRecommendations: optional('KAFKA_TOPIC_RECOMMENDATIONS', 'intervention.recommendations'),
    logLevel: optional('LOG_LEVEL', 'info'),
  };
}
