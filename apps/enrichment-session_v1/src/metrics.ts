import { MetricsCollector } from '@org/monitoring';

export class EnrichmentMetrics {
  private readonly mc: MetricsCollector;

  constructor() {
    this.mc = MetricsCollector.create();
  }

  eventsProcessed(status: 'success' | 'dropped' | 'deduplicated'): void {
    void this.mc.recordCounter('enrichment_events_processed_total', 1, { status });
  }

  processingLatency(ms: number): void {
    void this.mc.recordHistogram('enrichment_processing_latency_seconds', ms / 1000);
  }

  dbQueryLatency(operation: string, ms: number): void {
    void this.mc.recordHistogram('enrichment_db_query_latency_seconds', ms / 1000, { operation });
  }

  kafkaLag(partition: number, lag: number): void {
    void this.mc.recordGauge('enrichment_kafka_lag', lag, {
      partition: String(partition),
    });
  }

  bloomFalsePositive(): void {
    void this.mc.recordCounter('enrichment_redis_bloom_false_positive');
  }

  async getMetrics(): Promise<string> {
    return this.mc.getMetrics();
  }
}
