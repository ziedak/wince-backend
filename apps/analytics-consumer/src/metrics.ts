import { MetricsCollector } from '@org/monitoring';

export class AnalyticsMetrics {
  private readonly collector: MetricsCollector;

  private constructor(collector: MetricsCollector) {
    this.collector = collector;
  }

  static create(): AnalyticsMetrics {
    return new AnalyticsMetrics(MetricsCollector.create());
  }

  /** Increment per-status event counter. Pass count > 1 for batch success events. */
  async eventProcessed(
    status: 'success' | 'duplicate' | 'parse_error' | 'dlq',
    count = 1,
  ): Promise<void> {
    await this.collector.recordCounter('analytics_consumer_events_total', count, { status });
  }

  /** Total rows successfully inserted to ClickHouse */
  async rowsInserted(count: number): Promise<void> {
    await this.collector.recordCounter('analytics_consumer_rows_inserted_total', count, {});
  }

  /** Duration of a ClickHouse batch insert in milliseconds */
  async batchInsertLatency(ms: number): Promise<void> {
    await this.collector.recordHistogram('analytics_consumer_batch_insert_latency_ms', ms, {});
  }

  /** Number of rows in a flushed batch */
  async batchSize(size: number): Promise<void> {
    await this.collector.recordHistogram('analytics_consumer_batch_size_rows', size, {});
  }

  /** Increment retry counter for ClickHouse insert failures */
  async retryAttempt(): Promise<void> {
    await this.collector.recordCounter('analytics_consumer_insert_retries_total', 1, {});
  }

  /** Increment when an entire batch flush exhausts retries and falls back to DLQ (per-batch, not per-row). */
  async batchFlushFailure(table: string): Promise<void> {
    await this.collector.recordCounter('analytics_batch_flush_failure_total', 1, { table });
  }

  /** Increment DLQ counter */
  async dlqSent(reason: string): Promise<void> {
    await this.collector.recordCounter('analytics_consumer_dlq_total', 1, { reason });
  }

  /** Consumer group lag per topic-partition */
  async consumerLag(topic: string, partition: number, lag: number): Promise<void> {
    await this.collector.recordGauge('analytics_consumer_lag_messages', lag, {
      topic,
      partition: String(partition),
    });
  }

  /** Intervention lifecycle rows ($intervention_shown/clicked/etc.) written to ClickHouse */
  async interventionEventsInserted(count: number): Promise<void> {
    await this.collector.recordCounter('analytics_consumer_intervention_events_total', count, {});
  }

  /** Intervention lifecycle events dropped (missing intervention_id in props) */
  async interventionEventsDropped(reason: string): Promise<void> {
    await this.collector.recordCounter('analytics_consumer_intervention_events_dropped_total', 1, {
      reason,
    });
  }

  /** PostgreSQL insert failures for intervention lifecycle events (non-fatal) */
  async interventionPgInsertFailure(): Promise<void> {
    await this.collector.recordCounter(
      'analytics_consumer_intervention_pg_insert_failures_total',
      1,
      {},
    );
  }

  /** Result of the periodic Kafka-consumed-vs-ClickHouse-persisted reconciliation check */
  async reconciliationCheck(deltaAbs: number, deltaRatio: number): Promise<void> {
    await this.collector.recordGauge('analytics_consumer_reconciliation_delta_rows', deltaAbs, {});
    await this.collector.recordGauge(
      'analytics_consumer_reconciliation_delta_ratio',
      deltaRatio,
      {},
    );
  }

  /** Incremented when the reconciliation delta exceeds the configured tolerance */
  async reconciliationMismatch(): Promise<void> {
    await this.collector.recordCounter('analytics_consumer_reconciliation_mismatch_total', 1, {});
  }

  /** Expose Prometheus text for /metrics endpoint */
  getMetrics(): Promise<string> {
    return this.collector.getMetrics();
  }
}
