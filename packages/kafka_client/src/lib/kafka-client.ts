import { Kafka, type Producer, CompressionTypes, type Message } from 'kafkajs';
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

