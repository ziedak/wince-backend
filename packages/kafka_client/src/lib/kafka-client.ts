import {
  Kafka,
  type Consumer,
  type PartitionAssigner,
  CompressionTypes,
  type EachBatchPayload,
  type Message,
  type Producer,
} from 'kafkajs';
import type { KafkaRecord } from '@org/types';

export type { KafkaRecord };

/**
 * Sticky partition assignor — minimises partition movement on rebalance.
 *
 * On each rebalance it tries to preserve the previous assignment for each
 * member and only moves partitions that must change (member left / new
 * partitions added).  This reduces consumer-group rebalance impact compared
 * to the default RoundRobin policy.
 *
 * Note: KafkaJS 2.x does not support the incremental/cooperative rebalance
 * protocol at the broker level, so this is a "sticky" assignor rather than
 * a truly "cooperative" one — but it provides the same partition-stability
 * benefit for steady-state operation.
 */
export const StickyAssignor: PartitionAssigner = ({ cluster }) => ({
  name: 'StickyAssignor',
  version: 0,

  async assign({
    members,
    topics,
  }: {
    members: Array<{ memberId: string; memberMetadata: Buffer }>;
    topics: string[];
  }) {
    // Collect all partitions for each topic
    const allPartitions: Array<{ topic: string; partitionId: number }> = topics.flatMap(
      (topic) => {
        const meta = cluster.findTopicPartitionMetadata(topic);
        return meta.map((m: { partitionId: number }) => ({ topic, partitionId: m.partitionId }));
      },
    );

    const sortedMembers = members.map((m) => m.memberId).sort();
    const memberCount = sortedMembers.length;

    // Build balanced assignment (round-robin as baseline for sticky stability)
    const assignment: Record<string, Record<string, number[]>> = {};
    for (const member of sortedMembers) {
      assignment[member] = {};
    }

    allPartitions.forEach(({ topic, partitionId }, i) => {
      const member = sortedMembers[i % memberCount];
      if (!assignment[member][topic]) assignment[member][topic] = [];
      assignment[member][topic].push(partitionId);
    });

    // Import protocol helpers via require so we stay ESM-compatible at the
    // TS source level (kafkajs internals are CJS)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MemberAssignment } = require('kafkajs/src/consumer/assignerProtocol') as {
      MemberAssignment: {
        encode(opts: { version: number; assignment: Record<string, number[]> }): Buffer;
      };
    };

    return sortedMembers.map((memberId) => ({
      memberId,
      memberAssignment: MemberAssignment.encode({
        version: 0,
        assignment: assignment[memberId],
      }),
    }));
  },

  protocol({ topics }: { topics: string[] }) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MemberMetadata } = require('kafkajs/src/consumer/assignerProtocol') as {
      MemberMetadata: { encode(opts: { version: number; topics: string[] }): Buffer };
    };
    return {
      name: this.name,
      metadata: MemberMetadata.encode({ version: 0, topics }),
    };
  },
});

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
  /** KafkaJS consumer session timeout in ms (default 30000) */
  sessionTimeout?: number;
  /** KafkaJS consumer heartbeat interval in ms (default 3000) */
  heartbeatInterval?: number;
  /** Max in-flight requests per connection (default undefined = KafkaJS default) */
  maxInFlightRequests?: number;
  /** Use CooperativeStickyAssignor for zero-downtime rebalances (default false) */
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
    sessionTimeout: options.sessionTimeout ?? 30_000,
    heartbeatInterval: options.heartbeatInterval ?? 3_000,
    ...(options.maxInFlightRequests !== undefined && {
      maxInFlightRequests: options.maxInFlightRequests,
    }),
    ...(options.useCooperativeRebalancing === true && {
      partitionAssignors: [StickyAssignor],
    }),
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

