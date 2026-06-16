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

  /** Expose Prometheus text for /metrics endpoint */
  getMetrics(): Promise<string> {
    return this.collector.getMetrics();
  }
}
