import {
  createConsumerClient,
  createProducerClient,
  createAdminClient,
} from '@org/kafka_client';
import type { ConsumerClient, ProducerClient, AdminClient } from '@org/kafka_client';
import { createLogger } from '@org/logger';
import type { Logger } from '@org/logger';
import { executeWithRetry } from '@org/utils';
import type { RedisClient } from '@org/redis_client';
import type { ClickHouseClient } from '@org/clickhouse_client';
import { interventionEvents, type Db } from '@org/db';
import type { Config } from './config.js';
import type { AnalyticsMetrics } from './metrics.js';
import { Batcher } from './batcher.js';
import type { BatchOffset } from './batcher.js';
import { parseEnrichedEvent, toClickHouseRow } from './types.js';
import type { ClickHouseRow } from './types.js';
import {
  isInterventionLifecycleEvent,
  parseInterventionEventRow,
  toPostgresInterventionEvent,
} from './intervention-events.js';
import type { InterventionEventRow } from './intervention-events.js';

export interface ConsumerState {
  subscribed: boolean;
  backingOff: boolean;
}

export class AnalyticsConsumer {
  private readonly logger: Logger;
  public readonly state: ConsumerState = { subscribed: false, backingOff: false };
  private isShuttingDown = false;
  private isStarted = false;

  // Held for shutdown — set in start()
  private kafkaConsumer: ConsumerClient | null = null;
  private dlqProducer: ProducerClient | null = null;
  private adminClient: AdminClient | null = null;
  private lagPollTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;

  // Reconciliation baseline — rows this process has itself flushed to
  // ClickHouse since start(), compared against a live row count for the
  // same window to catch silent data loss (see runReconciliationCheck()).
  private rowsFlushedSinceStart = 0;
  private processStartedAt: Date | null = null;

  // Shared batcher across eachBatch calls (accumulates rows up to batchSize)
  private batcher: Batcher<ClickHouseRow> | null = null;
  // Separate batcher for $intervention_* lifecycle events (different table)
  private interventionBatcher: Batcher<InterventionEventRow> | null = null;
  // Saved commit function for shutdown flush
  private lastCommitFn: (() => Promise<void>) | null = null;

  // Batch drain promise so shutdown can wait for in-flight flushes
  private currentBatchDone: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: Config,
    private readonly clickhouse: ClickHouseClient,
    private readonly metrics: AnalyticsMetrics,
    private readonly redis: RedisClient ,
    private readonly db: Db,
  ) {
    this.logger = createLogger({ service: 'AnalyticsConsumer' });
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error('AnalyticsConsumer.start() called more than once');
    }
    this.isStarted = true;

    const consumer = createConsumerClient({
      brokers: this.config.kafkaBrokers,
      clientId: this.config.kafkaClientId,
      groupId: this.config.kafkaConsumerGroup,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      maxInFlightRequests: 1,
      useCooperativeRebalancing: true,
    });

    const dlqProducer = createProducerClient({
      brokers: this.config.kafkaBrokers,
      clientId: `${this.config.kafkaClientId}-dlq`,
    });

    const adminClient = createAdminClient({
      brokers: this.config.kafkaBrokers,
      clientId: this.config.kafkaAdminClientId,
    });

    this.kafkaConsumer = consumer;
    this.dlqProducer = dlqProducer;
    this.adminClient = adminClient;

    const batcher = new Batcher<ClickHouseRow>(
      this.config.batchSize,
      this.config.batchTimeoutMs,
    );
    this.batcher = batcher;

    const interventionBatcher = new Batcher<InterventionEventRow>(
      this.config.batchSize,
      this.config.batchTimeoutMs,
    );
    this.interventionBatcher = interventionBatcher;

    await consumer.connect();
    await consumer.subscribe(this.config.kafkaTopic, false);
    this.state.subscribed = true;
    this.logger.info({ topic: this.config.kafkaTopic }, 'Subscribed to enriched events topic');

    this.processStartedAt = new Date();
    this.startLagPolling();
    this.startReconciliation();

    const flushBatch = async (
      rows: ClickHouseRow[],
      offsets: BatchOffset[],
      commitFn: () => Promise<void>,
    ): Promise<void> => {
      if (rows.length === 0) return;

      const start = Date.now();
      try {
        await executeWithRetry(
          () =>
            this.clickhouse.batchInsert(this.config.clickhouseTable, rows as unknown as Record<string, unknown>[], {
              batchSize: rows.length,
              maxConcurrency: 1,
              delayBetweenBatches: 0,
            }),
          (err, attempt) => {
            this.logger.warn({ err, attempt, rows: rows.length }, 'ClickHouse insert retry');
            void this.metrics.retryAttempt();
          },
          {
            operationName: 'clickhouse_batch_insert',
            maxRetries: this.config.maxRetries,
            retryDelay: this.config.retryBaseDelayMs,
          },
        );

        await this.metrics.rowsInserted(rows.length);
        await this.metrics.batchInsertLatency(Date.now() - start);
        await this.metrics.batchSize(rows.length);
        this.rowsFlushedSinceStart += rows.length;
        await commitFn();

        this.logger.info({ rows: rows.length, offsets: offsets.length }, 'Batch flushed to ClickHouse');

        // Mark inserted event_ids in bloom filter — best-effort, never blocks commit.
        if (this.config.enableDedup) {
          void Promise.all(
            rows.map((r) =>
              this.redis.bfAdd(this.config.bloomFilterKey, r.eid).catch(() => undefined),
            ),
          );
        }

        await this.metrics.eventProcessed('success', rows.length);
      } catch (err) {
        this.logger.error(
          { err, rows: rows.length },
          'ClickHouse batch insert failed after retries — routing to DLQ',
        );
        await this.metrics.batchFlushFailure('events');
        // Send each row to DLQ individually so nothing is silently dropped
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const offset = offsets[i];
          await this.sendToDlq(JSON.stringify(row), 'batch_insert_failed', row.eid, offset);
          await this.metrics.dlqSent('batch_insert_failed');
          await this.metrics.eventProcessed('dlq');
        }
        // Commit even on failure so the consumer doesn't re-process indefinitely
        await commitFn().catch((e: unknown) =>
          this.logger.error({ err: e }, 'Offset commit failed after DLQ routing'),
        );
      }
    };

    const flushInterventionBatch = async (
      rows: InterventionEventRow[],
      offsets: BatchOffset[],
      commitFn: () => Promise<void>,
    ): Promise<void> => {
      if (rows.length === 0) return;

      try {
        await executeWithRetry(
          () =>
            this.clickhouse.batchInsert(
              this.config.clickhouseInterventionEventsTable,
              rows as unknown as Record<string, unknown>[],
              { batchSize: rows.length, maxConcurrency: 1, delayBetweenBatches: 0 },
            ),
          (err, attempt) => {
            this.logger.warn(
              { err, attempt, rows: rows.length },
              'ClickHouse intervention-events insert retry',
            );
            void this.metrics.retryAttempt();
          },
          {
            operationName: 'clickhouse_intervention_events_batch_insert',
            maxRetries: this.config.maxRetries,
            retryDelay: this.config.retryBaseDelayMs,
          },
        );

        await this.metrics.interventionEventsInserted(rows.length);
        await commitFn();

        this.logger.info(
          { rows: rows.length, offsets: offsets.length },
          'Intervention-events batch flushed to ClickHouse',
        );
      } catch (err) {
        this.logger.error(
          { err, rows: rows.length },
          'ClickHouse intervention-events insert failed after retries — routing to DLQ',
        );
        await this.metrics.batchFlushFailure('intervention_events');
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const offset = offsets[i];
          await this.sendToDlq(
            JSON.stringify(row),
            'intervention_batch_insert_failed',
            row.event_id,
            offset,
          );
          await this.metrics.dlqSent('intervention_batch_insert_failed');
        }
        await commitFn().catch((e: unknown) =>
          this.logger.error({ err: e }, 'Offset commit failed after intervention DLQ routing'),
        );
        return;
      }

      // Best-effort mirror into PostgreSQL — the `interventions` FK means a
      // row referencing an unknown/expired intervention_id will fail; that
      // failure is logged and skipped rather than blocking the (already
      // committed) ClickHouse write, since ClickHouse is the reporting
      // source of truth and Postgres here is a queryable lifecycle log.
      try {
        await this.db.insert(interventionEvents).values(rows.map(toPostgresInterventionEvent));
      } catch (err) {
        this.logger.warn(
          { err, rows: rows.length },
          'PostgreSQL intervention_events insert failed (non-fatal)',
        );
        await this.metrics.interventionPgInsertFailure();
      }
    };

    await consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: async ({
        batch,
        resolveOffset,
        commitOffsetsIfNecessary,
        heartbeat,
        isRunning,
        isStale,
      }) => {
        // Stable promise so shutdown() can await the current batch
        let batchDoneResolve!: () => void;
        this.currentBatchDone = new Promise<void>((res) => {
          batchDoneResolve = res;
        });
        this.lastCommitFn = commitOffsetsIfNecessary;

        let rowsAddedThisBatch = 0;
        let interventionRowsAddedThisBatch = 0;

        try {
          for (const message of batch.messages) {
            if (!isRunning() || this.isShuttingDown) {
              // Roll back rows added in this iteration only; shutdown() will
              // flush any rows accumulated across previous batches.
              batcher.rollback(rowsAddedThisBatch);
              interventionBatcher.rollback(interventionRowsAddedThisBatch);
              break;
            }
            if (isStale()) {
              // Partition revoked — discard ALL buffered rows so the partition's
              // new assignee re-processes them cleanly (no double-insert).
              batcher.drain();
              interventionBatcher.drain();
              break;
            }

            const rawStr = message.value?.toString('utf8') ?? null;

            // ── Parse ──────────────────────────────────────────────────────
            let parsed: unknown = null;
            if (rawStr !== null) {
              try {
                parsed = JSON.parse(rawStr);
              } catch {
                /* invalid JSON — fall through to parse-error path */
              }
            }

            const event = parsed !== null ? parseEnrichedEvent(parsed) : null;

            if (event === null) {
              this.logger.warn(
                { offset: message.offset, partition: batch.partition },
                'Unparseable message — routing to DLQ',
              );
              await this.sendToDlq(
                rawStr,
                'parse_error',
                message.key?.toString('utf8') ?? message.offset,
                { topic: batch.topic, partition: batch.partition, offset: message.offset },
              );
              await this.metrics.eventProcessed('parse_error');
              await this.metrics.dlqSent('parse_error');
              resolveOffset(message.offset);
              await heartbeat();
              continue;
            }

            // ── Dedup (bloom filter) ────────────────────────────────────────
            if (this.config.enableDedup) {
              const isDup = await this.redis
                .bfExists(this.config.bloomFilterKey, event.eid)
                .catch(() => false);
              if (isDup) {
                await this.metrics.eventProcessed('duplicate');
                resolveOffset(message.offset);
                await heartbeat();
                continue;
              }
            }

            // ── Intervention lifecycle events go to a separate table ───────
            if (isInterventionLifecycleEvent(event.t)) {
              const interventionRow = parseInterventionEventRow(event);
              if (interventionRow === null) {
                this.logger.warn(
                  { offset: message.offset, t: event.t },
                  'Intervention event missing intervention_id in props — dropping',
                );
                await this.metrics.interventionEventsDropped('missing_intervention_id');
                resolveOffset(message.offset);
                await heartbeat();
                continue;
              }

              interventionBatcher.add(interventionRow, message.offset, batch.partition, batch.topic);
              interventionRowsAddedThisBatch++;
              resolveOffset(message.offset);

              if (interventionBatcher.isSizeFull()) {
                const { rows, offsets } = interventionBatcher.drain();
                interventionRowsAddedThisBatch = 0;
                await flushInterventionBatch(rows, offsets, commitOffsetsIfNecessary);
              }

              await heartbeat();
              continue;
            }

            // ── Transform & buffer ─────────────────────────────────────────
            const row = toClickHouseRow(event);
            batcher.add(row, message.offset, batch.partition, batch.topic);
            rowsAddedThisBatch++;
            resolveOffset(message.offset);

            // ── Size-based flush ───────────────────────────────────────────
            if (batcher.isSizeFull()) {
              const { rows, offsets } = batcher.drain();
              rowsAddedThisBatch = 0;
              await flushBatch(rows, offsets, commitOffsetsIfNecessary);
            }

            await heartbeat();
          }

          // ── Time-based / end-of-batch flush ───────────────────────────────
          if (!batcher.isEmpty() && batcher.isTimeExpired()) {
            const { rows, offsets } = batcher.drain();
            await flushBatch(rows, offsets, commitOffsetsIfNecessary);
          }
          if (!interventionBatcher.isEmpty() && interventionBatcher.isTimeExpired()) {
            const { rows, offsets } = interventionBatcher.drain();
            await flushInterventionBatch(rows, offsets, commitOffsetsIfNecessary);
          }
        } finally {
          batchDoneResolve();
        }
      },
    });
  }

  private async sendToDlq(
    original: string | null,
    reason: string,
    key: string,
    source?: BatchOffset,
  ): Promise<void> {
    try {
      await this.dlqProducer?.send(this.config.kafkaDlqTopic, key, {
        reason,
        original,
        original_topic: source?.topic ?? null,
        original_partition: source?.partition ?? null,
        original_offset: source?.offset ?? null,
        service: 'analytics-consumer',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error({ err }, 'Failed to send message to DLQ');
    }
  }

  private startLagPolling(): void {
    if (this.adminClient === null) return;
    this.lagPollTimer = setInterval(() => {
      void this.pollLag();
    }, this.config.lagPollIntervalMs);
  }

  private async pollLag(): Promise<void> {
    if (this.adminClient === null) return;
    try {
      const lags = await this.adminClient.fetchConsumerGroupLag(
        this.config.kafkaConsumerGroup,
        [this.config.kafkaTopic],
      );
      for (const entry of lags) {
        await this.metrics.consumerLag(entry.topic, entry.partition, entry.lag);
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to fetch consumer group lag');
    }
  }

  /**
   * Lightweight, in-process substitute for a standalone "Reconciliation
   * Worker" (docs/services/Analytics Consumer.md §8). Rather than a separate
   * deployable service comparing Kafka topic offsets against ClickHouse (which
   * would need its own offset-vs-retention bookkeeping to be meaningful), this
   * compares rows this process has itself successfully flushed since start()
   * against a live ClickHouse count for the same window. A growing mismatch
   * indicates rows are being lost between a successful `commitFn()` and
   * durable ClickHouse storage (e.g. a bug in batchInsert, or another writer
   * deleting rows) that DLQ/error metrics wouldn't otherwise surface.
   */
  private startReconciliation(): void {
    if (this.config.reconciliationIntervalMs <= 0) return;
    this.reconciliationTimer = setInterval(() => {
      void this.runReconciliationCheck();
    }, this.config.reconciliationIntervalMs);
  }

  private async runReconciliationCheck(): Promise<void> {
    if (this.processStartedAt === null) return;
    try {
      const rows = await this.clickhouse.execute<Array<{ cnt: string }>>(
        `SELECT count() AS cnt FROM ${this.config.clickhouseTable} WHERE server_timestamp >= {startedAt: DateTime64(3)}`,
        { startedAt: this.processStartedAt.toISOString() },
      );
      const chCount = Number(rows[0]?.cnt ?? 0);
      const expected = this.rowsFlushedSinceStart;
      const deltaAbs = Math.abs(chCount - expected);
      const deltaRatio = deltaAbs / Math.max(expected, 1);

      await this.metrics.reconciliationCheck(deltaAbs, deltaRatio);

      if (deltaRatio > this.config.reconciliationToleranceRatio) {
        this.logger.warn(
          { chCount, expected, deltaAbs, deltaRatio },
          'Reconciliation mismatch: ClickHouse row count diverges from rows flushed by this process',
        );
        await this.metrics.reconciliationMismatch();
      } else {
        this.logger.debug({ chCount, expected }, 'Reconciliation check OK');
      }
    } catch (err) {
      this.logger.warn({ err }, 'Reconciliation check failed');
    }
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.logger.info('AnalyticsConsumer shutdown initiated');

    // Stop lag polling
    if (this.lagPollTimer !== null) {
      clearInterval(this.lagPollTimer);
      this.lagPollTimer = null;
    }

    // Stop reconciliation checks
    if (this.reconciliationTimer !== null) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }

    // Wait for the in-flight eachBatch to finish (max 30 s)
    const drainTimeout = new Promise<void>((resolve) => setTimeout(resolve, 30_000));
    await Promise.race([this.currentBatchDone, drainTimeout]);

    // Flush any remaining rows buffered from previous batches
    if (this.batcher !== null && !this.batcher.isEmpty() && this.lastCommitFn !== null) {
      const { rows, offsets } = this.batcher.drain();
      this.logger.info({ rows: rows.length }, 'Flushing residual batch on shutdown');
      try {
        await this.clickhouse.batchInsert(this.config.clickhouseTable, rows as unknown as Record<string, unknown>[], {
          batchSize: rows.length,
          maxConcurrency: 1,
          delayBetweenBatches: 0,
        });
        await this.lastCommitFn();
        this.logger.info({ rows: rows.length }, 'Residual batch flushed');
      } catch (err) {
        this.logger.error({ err, rows: rows.length, offsets: offsets.length }, 'Residual flush failed on shutdown');
      }
    }

    // Flush any remaining intervention-event rows buffered from previous batches
    if (
      this.interventionBatcher !== null &&
      !this.interventionBatcher.isEmpty() &&
      this.lastCommitFn !== null
    ) {
      const { rows, offsets } = this.interventionBatcher.drain();
      this.logger.info({ rows: rows.length }, 'Flushing residual intervention-events batch on shutdown');
      try {
        await this.clickhouse.batchInsert(
          this.config.clickhouseInterventionEventsTable,
          rows as unknown as Record<string, unknown>[],
          { batchSize: rows.length, maxConcurrency: 1, delayBetweenBatches: 0 },
        );
        await this.lastCommitFn();
        try {
          await this.db.insert(interventionEvents).values(rows.map(toPostgresInterventionEvent));
        } catch (err) {
          this.logger.warn({ err, rows: rows.length }, 'PostgreSQL intervention_events residual insert failed (non-fatal)');
        }
        this.logger.info({ rows: rows.length }, 'Residual intervention-events batch flushed');
      } catch (err) {
        this.logger.error(
          { err, rows: rows.length, offsets: offsets.length },
          'Residual intervention-events flush failed on shutdown',
        );
      }
    }

    await this.kafkaConsumer
      ?.shutdown()
      .catch((err: unknown) => this.logger.error({ err }, 'Kafka consumer shutdown error'));
    await this.dlqProducer
      ?.shutdown()
      .catch((err: unknown) => this.logger.error({ err }, 'DLQ producer shutdown error'));
    await this.adminClient
      ?.shutdown()
      .catch((err: unknown) => this.logger.error({ err }, 'Admin client shutdown error'));

    this.state.subscribed = false;
    this.logger.info('AnalyticsConsumer shutdown complete');
  }
}
