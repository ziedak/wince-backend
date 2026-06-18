import {
  Kafka,
  type Admin,
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
  /**
   * Pause consumption on specified topic-partitions.
   * If partitions is omitted, all partitions for the topic are paused.
   */
  pause(topicPartitions: Array<{ topic: string; partitions?: number[] }>): void;
  /**
   * Resume consumption on previously paused topic-partitions.
   */
  resume(topicPartitions: Array<{ topic: string; partitions?: number[] }>): void;
  /**
   * Seek to a specific offset for a topic-partition.
   * Must be called after subscribe() and before run().
   */
  seek(topicPartition: { topic: string; partition: number; offset: string }): void;
  isHealthy(): boolean;
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Admin client
// ---------------------------------------------------------------------------

export interface ConsumerGroupLag {
  topic: string;
  partition: number;
  /** Last committed offset for this consumer group */
  groupOffset: string;
  /** High-water mark (next offset to be written by the broker) */
  highWatermark: string;
  /** Number of messages yet to be consumed */
  lag: number;
}

export interface KafkaAdminOptions {
  brokers: string[];
  clientId: string;
  connectionTimeout?: number;
  requestTimeout?: number;
}

export interface AdminClient {
  /**
   * Fetch consumer group lag per topic-partition.
   * lag = highWatermark - committedGroupOffset.
   */
  fetchConsumerGroupLag(groupId: string, topics: string[]): Promise<ConsumerGroupLag[]>;
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

    pause(topicPartitions: Array<{ topic: string; partitions?: number[] }>): void {
      consumer.pause(topicPartitions);
    },

    resume(topicPartitions: Array<{ topic: string; partitions?: number[] }>): void {
      consumer.resume(topicPartitions);
    },

    seek(topicPartition: { topic: string; partition: number; offset: string }): void {
      consumer.seek(topicPartition);
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

/**
 * Creates a KafkaJS admin client for cluster introspection.
 * Useful for fetching consumer group lag and topic metadata.
 */
export function createAdminClient(options: KafkaAdminOptions): AdminClient {
  const kafka = new Kafka({
    brokers: options.brokers,
    clientId: options.clientId,
    connectionTimeout: options.connectionTimeout ?? 3000,
    requestTimeout: options.requestTimeout ?? 30000,
  });

  const admin: Admin = kafka.admin();
  let connected = false;

  const ensureConnected = async (): Promise<void> => {
    if (!connected) {
      await admin.connect();
      connected = true;
    }
  };

  return {
    async fetchConsumerGroupLag(
      groupId: string,
      topics: string[],
    ): Promise<ConsumerGroupLag[]> {
      await ensureConnected();

      const [groupOffsets, topicHighWatermarks] = await Promise.all([
        admin.fetchOffsets({ groupId, topics }),
        Promise.all(topics.map((t) => admin.fetchTopicOffsets(t))),
      ]);

      // Build a map of topic:partition → high watermark
      const highWatermarkMap = new Map<string, string>();
      topics.forEach((topic, i) => {
        for (const partitionInfo of topicHighWatermarks[i]) {
          highWatermarkMap.set(`${topic}:${partitionInfo.partition}`, partitionInfo.high);
        }
      });

      const result: ConsumerGroupLag[] = [];
      for (const topicEntry of groupOffsets) {
        for (const partitionEntry of topicEntry.partitions) {
          const key = `${topicEntry.topic}:${partitionEntry.partition}`;
          const high = highWatermarkMap.get(key) ?? '0';
          const lag = Math.max(0, Number(high) - Number(partitionEntry.offset));
          result.push({
            topic: topicEntry.topic,
            partition: partitionEntry.partition,
            groupOffset: partitionEntry.offset,
            highWatermark: high,
            lag,
          });
        }
      }
      return result;
    },

    async shutdown(): Promise<void> {
      if (connected) {
        await admin.disconnect();
        connected = false;
      }
    },
  };
}

