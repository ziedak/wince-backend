import { createConsumerClient, createProducerClient } from '@org/kafka_client';
import type { ConsumerClient, ProducerClient } from '@org/kafka_client';
import { createLogger } from '@org/logger';
import type { Logger } from '@org/logger';
import type { EnrichedEvent } from '@org/types';
import type { Config } from '../config.js';
import { DecisionMetrics } from '../metrics.js';
import { DecisionOrchestrator } from '../services/intervention.service.js';
import { LockService } from '../services/lock.service.js';
import { SchedulerService } from '../services/scheduler.service.js';


/** Event types that may trigger an intervention. All other types are ignored. */
const TRIGGER_EVENTS = new Set(['checkout_abandon', 'exit_intent', 'idle_timeout']);
/** Purchase events clear post-conversion state to prevent follow-up interventions. */
const PURCHASE_EVENT = 'purchase';

const RETRY_DELAYS = [100, 200, 400];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  delays: number[],
  logger: Logger,
  label: string,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < delays.length) {
        logger.warn({ err, attempt: attempt + 1, label }, 'Retrying after error');
        await sleep(delays[attempt]);
      }
    }
  }
  throw lastErr;
}

export interface ConsumerState {
  subscribed: boolean;
  backingOff: boolean;
}

/**
 * Kafka consumer for the `enriched.events` topic.
 * Mirrors the EnrichmentConsumer pattern: KafkaJS manual-commit,
 * cooperative rebalancing, per-message processing, DLQ on persistent failure.
 *
 * Only events with `t` in TRIGGER_EVENTS are forwarded to the orchestrator.
 */
export class DecisionConsumer {
  private readonly logger: Logger;
  public readonly state: ConsumerState = { subscribed: false, backingOff: false };
  private isShuttingDown = false;
  private currentBatchDone: Promise<void> = Promise.resolve();
  private currentBatchResolve: (() => void) | null = null;
  private kafkaConsumer: ConsumerClient | null = null;
  private kafkaProducer: ProducerClient | null = null;

  constructor(
    private readonly config: Config,
    private readonly orchestrator: DecisionOrchestrator,
    private readonly metrics: DecisionMetrics,
    private readonly lock: LockService,
    private readonly scheduler: SchedulerService,
  ) {
    this.logger = createLogger({ service: 'DecisionConsumer' });
  }

  async start(): Promise<void> {
    const consumer = createConsumerClient({
      brokers: this.config.kafkaBrokers,
      clientId: 'decision-engine',
      groupId: this.config.kafkaGroupId,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      maxInFlightRequests: 1,
      useCooperativeRebalancing: true,
    });

    const producer = createProducerClient({
      brokers: this.config.kafkaBrokers,
      clientId: 'decision-engine-producer',
    });

    this.kafkaConsumer = consumer;
    this.kafkaProducer = producer;

    const sendToDlq = async (
      original: string | null,
      reason: string,
      key: string,
    ): Promise<void> => {
      try {
        await producer.send(this.config.kafkaTopicDlq, key, {
          reason,
          original,
          service: 'decision-engine',
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.error({ err }, 'Failed to send to DLQ');
      }
    };

    await consumer.connect();
    await consumer.subscribe(this.config.kafkaTopicEnriched, false);
    this.state.subscribed = true;
    this.logger.info({ topic: this.config.kafkaTopicEnriched }, 'Subscribed to enriched events topic');

    await consumer.run({
      autoCommit: false,
      eachBatch: async ({
        batch,
        resolveOffset,
        heartbeat,
        commitOffsetsIfNecessary,
        isRunning,
        isStale,
      }) => {
        this.currentBatchDone = new Promise<void>((resolve) => {
          this.currentBatchResolve = resolve;
        });

        try {
          for (const message of batch.messages) {
            if (!isRunning() || isStale() || this.isShuttingDown) break;

            const rawStr = message.value?.toString() ?? null;
            const key = message.key?.toString() ?? 'unknown';

            // Parse — invalid JSON goes straight to DLQ
            let event: EnrichedEvent | null = null;
            try {
              if (!rawStr) throw new Error('empty message');
              event = JSON.parse(rawStr) as EnrichedEvent;
            } catch {
              this.logger.warn({ key }, 'Invalid JSON in message — sending to DLQ');
              await sendToDlq(rawStr, 'invalid_json', key);
              resolveOffset(message.offset);
              await heartbeat();
              continue;
            }

            // Guard (v2 spec §1): events missing a resolved user identity go to DLQ.
            // The Decision Engine's contract requires both customer_id and cart_value;
            // events missing customer_id cannot be locked, scored, or budget-gated correctly.
            if (event.customer_id === null || event.customer_id === undefined) {
              this.logger.warn({ key, eid: event.eid }, 'Missing customer_id — routing to DLQ');
              await sendToDlq(rawStr, 'missing_user_id', key);
              resolveOffset(message.offset);
              await heartbeat();
              continue;
            }

            // Purchase cleanup (v2 spec §4.4): clear all post-conversion state so a repeat
            // buyer's next session starts fresh without triggering cooldown blocks.
            if (event.t === PURCHASE_EVENT) {
              await this.lock.clearUserSent(event.customer_id);
              await this.scheduler.clearUserSessions(event.customer_id, event.store_id);
              this.logger.debug({ customerId: event.customer_id, storeId: event.store_id }, 'Purchase: cleared user state');
              resolveOffset(message.offset);
              await heartbeat();
              continue;
            }

            // Filter — only trigger events reach the orchestrator
            if (!TRIGGER_EVENTS.has(event.t)) {
              resolveOffset(message.offset);
              await heartbeat();
              continue;
            }

            const t0 = Date.now();

            // Decide with retry (3 attempts, exponential backoff)
            try {
              await withRetry(
                () => this.orchestrator.decide(event!),
                RETRY_DELAYS,
                this.logger,
                'decide',
              );
            } catch (err) {
              this.logger.error(
                { err, eid: event.eid, sessionId: event.sid },
                'Decision failed after retries — sending to DLQ',
              );
              await sendToDlq(rawStr, 'decision_failed', key);
              this.state.backingOff = true;
              await sleep(5_000);
              this.state.backingOff = false;
              resolveOffset(message.offset);
              await heartbeat();
              continue;
            }

            this.metrics.kafkaLag(
              batch.partition,
              Number(message.offset) > 0
                ? Number(batch.highWatermark) - Number(message.offset)
                : 0,
            );
            this.logger.debug({ eid: event.eid, latencyMs: Date.now() - t0 }, 'Event decided');

            resolveOffset(message.offset);
            await heartbeat();
          }

          await commitOffsetsIfNecessary();
        } finally {
          this.currentBatchResolve?.();
          this.currentBatchResolve = null;
        }
      },
    });
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Shutdown requested — waiting for current batch to finish (max 30s)');
    await Promise.race([this.currentBatchDone, sleep(30_000)]);
    await this.kafkaConsumer?.shutdown();
    await this.kafkaProducer?.shutdown();
    this.logger.info('Shutdown complete');
  }
}
