import { createConsumerClient, createProducerClient } from '@org/kafka_client';
import type { ConsumerClient, ProducerClient } from '@org/kafka_client';
import { createLogger } from '@org/logger';
import type { Logger } from '@org/logger';
import type { Config } from './config.js';
import type { Enricher } from './enricher.js';
import type { IdempotencyService } from './idempotency.js';
import type { EnrichmentMetrics } from './metrics.js';
import type { RawEvent } from './types.js';

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

export class EnrichmentConsumer {
  private readonly logger: Logger;
  public readonly state: ConsumerState = { subscribed: false, backingOff: false };
  private isShuttingDown = false;
  private currentBatchDone: Promise<void> = Promise.resolve();
  private currentBatchResolve: (() => void) | null = null;
  // Held for shutdown — set once start() creates them
  private kafkaConsumer: ConsumerClient | null = null;
  private kafkaProducer: ProducerClient | null = null;

  constructor(
    private readonly config: Config,
    private readonly enricher: Enricher,
    private readonly idempotency: IdempotencyService,
    private readonly metrics: EnrichmentMetrics,
  ) {
    this.logger = createLogger({ service: 'EnrichmentConsumer' });
  }

  async start(): Promise<void> {
    const consumer = createConsumerClient({
      brokers: this.config.kafkaBrokers,
      clientId: 'enrichment-session',
      groupId: this.config.kafkaConsumerGroup,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      maxInFlightRequests: 1,
      useCooperativeRebalancing: true,
    });

    const producer = createProducerClient({
      brokers: this.config.kafkaBrokers,
      clientId: 'enrichment-session-producer',
    });

    this.kafkaConsumer = consumer;
    this.kafkaProducer = producer;

    const sendToDlq = async (
      original: string | null,
      reason: string,
      key: string,
    ): Promise<void> => {
      try {
        await producer.send(this.config.kafkaDlqTopic, key, {
          reason,
          original,
          service: 'enrichment-session',
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.error({ err }, 'Failed to send to DLQ');
      }
    };

    await consumer.connect();
    await consumer.subscribe(this.config.kafkaRawTopic, false);
    this.state.subscribed = true;
    this.logger.info({ topic: this.config.kafkaRawTopic }, 'Subscribed to raw events topic');

    await consumer.run({
      autoCommit: false,
      eachBatch: async ({ batch, resolveOffset, heartbeat, commitOffsetsIfNecessary, isRunning, isStale }) => {
        // Track the in-flight batch promise so shutdown() can wait for it
        this.currentBatchDone = new Promise<void>((resolve) => {
          this.currentBatchResolve = resolve;
        });

        try {
          for (const message of batch.messages) {
            if (!isRunning() || isStale() || this.isShuttingDown) break;

            const rawStr = message.value?.toString() ?? null;
            const key = message.key?.toString() ?? 'unknown';

            // Parse — invalid JSON goes straight to DLQ
            let raw: RawEvent | null = null;
            try {
              if (!rawStr) throw new Error('empty message');
              raw = JSON.parse(rawStr) as RawEvent;
            } catch {
              this.logger.warn({ key }, 'Invalid JSON in message, sending to DLQ');
              await sendToDlq(rawStr, 'invalid_json', key);
              resolveOffset(message.offset);
              await heartbeat();
              this.metrics.eventsProcessed('dropped');
              continue;
            }

            const t0 = Date.now();

            // Enrich with retry (3 attempts, exponential backoff)
            let result;
            try {
              result = await withRetry(
                () => this.enricher.enrich(raw!),
                RETRY_DELAYS,
                this.logger,
                'enrich',
              );
            } catch (err) {
              this.logger.error({ err, event_id: raw.event_id }, 'Enrichment failed after retries, backing off 5s');
              await sendToDlq(rawStr, 'enrichment_failed', key);
              this.state.backingOff = true;
              await sleep(5_000);
              this.state.backingOff = false;
              resolveOffset(message.offset);
              await heartbeat();
              this.metrics.eventsProcessed('dropped');
              continue;
            }

            if (result.kind === 'duplicate') {
              resolveOffset(message.offset);
              await heartbeat();
              this.metrics.eventsProcessed('deduplicated');
              continue;
            }

            // result.kind === 'enriched' — produce to enriched.events
            let produced = false;
            try {
              await withRetry(
                () => producer.send(
                  this.config.kafkaEnrichedTopic,
                  raw!.session_id,
                  result.event,
                ),
                RETRY_DELAYS,
                this.logger,
                'produce',
              );
              produced = true;
              // Mark idempotent only after confirmed produce — preserves at-least-once
              await this.idempotency.markProcessed(raw.event_id);
            } catch (err) {
              this.logger.error({ err, event_id: raw.event_id }, 'Produce failed after retries, sending to DLQ');
              await sendToDlq(rawStr, 'produce_failed', key);
            }

            resolveOffset(message.offset);
            await heartbeat();

            if (produced) {
              this.metrics.processingLatency(Date.now() - t0);
              this.metrics.eventsProcessed('success');
            } else {
              this.metrics.eventsProcessed('dropped');
            }
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

    // Wait for the in-flight batch, bounded by 30s
    await Promise.race([this.currentBatchDone, sleep(30_000)]);

    await this.kafkaConsumer?.shutdown();
    await this.kafkaProducer?.shutdown();
    this.logger.info('Shutdown complete');
  }
}

