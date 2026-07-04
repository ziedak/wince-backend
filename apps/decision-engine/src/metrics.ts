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

  /**
   * Observes a computed risk score in the distribution histogram.
   * Call once per `riskScorer.score()` result (excluding null/gated returns).
   */
  riskScoreObserved(score: number): void {
    void this.mc.recordHistogram('risk_score_distribution', score);
  }

  /**
   * Increments the lock acquisition failure counter.
   * Called when a Redis error forces fail-open in session or cart lock.
   */
  lockAcquireFailed(type: 'session' | 'cart' | 'user'): void {
    void this.mc.recordCounter('lock_acquire_failed_total', 1, { type });
  }

  /**
   * Increments the ONNX fallback counter.
   * Called when the model is loaded but inference returns null (timeout or error).
   */
  onnxFallback(): void {
    void this.mc.recordCounter('onnx_fallback_total');
  }

  /**
   * Increments the feature degradation counter.
   * Called when the FeatureService returns zero features due to ClickHouse or cache failure.
   * Enables alerting on sustained ClickHouse outages (threshold: >5% of decisions).
   */
  featureDegraded(): void {
    void this.mc.recordCounter('decision_degraded_features_total');
  }

  /**
   * Tracks ONNX circuit breaker state transitions.
   * Called on break (open) and reset (closed) events from the cockatiel circuit breaker.
   */
  onnxCircuitStateChange(state: 'open' | 'closed'): void {
    void this.mc.recordCounter('onnx_circuit_state_total', 1, { state });
  }

  async getMetrics(): Promise<string> {
    return this.mc.getMetrics();
  }
}
