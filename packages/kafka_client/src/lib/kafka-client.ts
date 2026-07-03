import {
  Kafka,
  type Consumer,
  CompressionTypes,
  type EachBatchPayload,
  type Message,
  type Producer,
} from 'kafkajs';
import type { KafkaRecord } from '@org/types';

export type { KafkaRecord };

export interface KafkaProducerOptions {
  brokers: string[];
  clientId: string;
  /** Connection timeout in ms (default 3000) */
  connectionTimeout?: number;
  /** Request timeout in ms (default 30000) */
  requestTimeout?: number;
}

export interface ProducerClient {
  send(topic: string, key: string, value: unknown): Promise<void>;
  sendBatch(records: KafkaRecord[]): Promise<void>;
  isHealthy(): boolean;
  shutdown(): Promise<void>;
}

export interface KafkaConsumerOptions {
  brokers: string[];
  clientId: string;
  groupId: string;
  connectionTimeout?: number;
  requestTimeout?: number;
  /** KafkaJS session timeout in ms (default 30000) */
  sessionTimeout?: number;
  /** KafkaJS heartbeat interval in ms (default 3000) */
  heartbeatInterval?: number;
  /** Maximum number of in-flight requests per connection (default 1) */
  maxInFlightRequests?: number;
  /** Use cooperative (incremental) rebalancing strategy instead of eager */
  useCooperativeRebalancing?: boolean;
}

export interface ConsumerClient {
  connect(): Promise<void>;
  subscribe(topic: string, fromBeginning?: boolean): Promise<void>;
  run(options: Parameters<Consumer['run']>[0]): Promise<void>;
  isHealthy(): boolean;
  shutdown(): Promise<void>;
}

export type KafkaEachBatchPayload = EachBatchPayload;

/**
 * Creates an idempotent KafkaJS producer.
 * Idempotent delivery is always enabled — never make this configurable.
 */
export function createProducerClient(options: KafkaProducerOptions): ProducerClient {
  const kafka = new Kafka({
    brokers: options.brokers,
    clientId: options.clientId,
    connectionTimeout: options.connectionTimeout ?? 3000,
    requestTimeout: options.requestTimeout ?? 30000,
  });

  const producer: Producer = kafka.producer({
    idempotent: true,
    transactionTimeout: 30000,
  });

  let connected = false;
  let connectError: Error | null = null;

  // Connect eagerly so isHealthy() reflects real broker state.
  void producer
    .connect()
    .then(() => {
      connected = true;
    })
    .catch((err: unknown) => {
      connectError = err instanceof Error ? err : new Error(String(err));
    });

  return {
    async send(topic: string, key: string, value: unknown): Promise<void> {
      const message: Message = {
        key,
        value: JSON.stringify(value),
      };
      await producer.send({
        topic,
        compression: CompressionTypes.Snappy,
        messages: [message],
      });
    },

    async sendBatch(records: KafkaRecord[]): Promise<void> {
      if (records.length === 0) return;

      // Group by topic to minimise batch call count.
      const byTopic = new Map<string, Message[]>();
      for (const rec of records) {
        const msgs = byTopic.get(rec.topic) ?? [];
        msgs.push({ key: rec.key, value: JSON.stringify(rec.value) });
        byTopic.set(rec.topic, msgs);
      }

      await producer.sendBatch({
        compression: CompressionTypes.Snappy,
        topicMessages: Array.from(byTopic.entries()).map(([topic, messages]) => ({
          topic,
          messages,
        })),
      });
    },

    isHealthy(): boolean {
      return connected && connectError === null;
    },

    async shutdown(): Promise<void> {
      await producer.disconnect();
      connected = false;
    },
  };
}

/**
 * Creates a KafkaJS consumer wrapper for long-running worker services.
 */
export function createConsumerClient(options: KafkaConsumerOptions): ConsumerClient {
  const kafka = new Kafka({
    brokers: options.brokers,
    clientId: options.clientId,
    connectionTimeout: options.connectionTimeout ?? 3000,
    requestTimeout: options.requestTimeout ?? 30000,
  });

  const consumer: Consumer = kafka.consumer({
    groupId: options.groupId,
    sessionTimeout: options.sessionTimeout,
    heartbeatInterval: options.heartbeatInterval,
    maxInFlightRequests: options.maxInFlightRequests,
    rebalanceTimeout: options.sessionTimeout,
  });

  let connected = false;
  let connectError: Error | null = null;
  const connectPromise = consumer
    .connect()
    .then(() => {
      connected = true;
    })
    .catch((err: unknown) => {
      connectError = err instanceof Error ? err : new Error(String(err));
      throw connectError;
    });

  return {
    async connect(): Promise<void> {
      await connectPromise;
    },

    async subscribe(topic: string, fromBeginning = false): Promise<void> {
      await consumer.subscribe({ topic, fromBeginning });
    },

    async run(options: Parameters<Consumer['run']>[0]): Promise<void> {
      await consumer.run(options);
    },

    isHealthy(): boolean {
      return connected && connectError === null;
    },

    async shutdown(): Promise<void> {
      await consumer.disconnect();
      connected = false;
    },
  };
}

