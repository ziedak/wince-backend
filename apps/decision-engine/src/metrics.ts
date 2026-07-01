import { MetricsCollector } from '@org/monitoring';

export class DecisionMetrics {
  private readonly mc: MetricsCollector;

  constructor() {
    this.mc = MetricsCollector.create();
  }

  decisionLatency(ms: number): void {
    void this.mc.recordHistogram('decision_latency_ms', ms);
  }

  interventionTotal(type: string, channel: string, variant: string): void {
    void this.mc.recordCounter('intervention_total', 1, { type, channel, variant });
  }

  outboundDuration(channel: string, ms: number): void {
    void this.mc.recordHistogram('outbound_push_ms', ms, { channel });
  }

  onnxInferenceDuration(ms: number): void {
    void this.mc.recordHistogram('onnx_inference_ms', ms);
  }

  dbOperation(db: string, operation: string, durationMs: number): void {
    void this.mc.recordHistogram('db_operation_ms', durationMs, { db, operation });
  }

  kafkaLag(partition: number, lag: number): void {
    void this.mc.recordGauge('decision_kafka_lag', lag, { partition: String(partition) });
  }

  cooldownHit(): void {
    void this.mc.recordCounter('decision_cooldown_hit_total');
  }

  budgetExhausted(): void {
    void this.mc.recordCounter('decision_budget_exhausted_total');
  }

  async getMetrics(): Promise<string> {
    return this.mc.getMetrics();
  }
}
