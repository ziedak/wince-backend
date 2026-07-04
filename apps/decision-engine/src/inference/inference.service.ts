import { createLogger } from '@org/logger';
import { circuitBreaker, ConsecutiveBreaker, handleAll, BrokenCircuitError } from 'cockatiel';
import type { CustomerFeatures } from '../features/features.service.js';
import type { DecisionMetrics } from '../metrics.js';
import type { InterventionType, InterventionChannel } from '@org/types';

export interface InferenceResult {
  confidence: number;
  /**
   * Model-driven routing fields. Available once the ONNX model emits these outputs
   * per v2 spec Open Item #12. When absent, the rules engine determines
   * type, channel, and value as fallback.
   */
  type?: InterventionType;
  channel?: InterventionChannel;
  value?: number;
}

export class InferenceService {
  private readonly logger = createLogger({ service: 'InferenceService' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any | null = null;
  private readonly ready: Promise<void>;
  /** Cockatiel circuit breaker — opens after 5 consecutive ONNX failures, resets after 5 min. */
  private readonly onnxBreaker = circuitBreaker(handleAll, {
    halfOpenAfter: 5 * 60_000,
    breaker: new ConsecutiveBreaker(5),
  });

  constructor(
    private readonly modelPath: string | undefined,
    private readonly metrics: DecisionMetrics,
  ) {
    this.ready = this.init();
    this.onnxBreaker.onBreak(() => {
      this.logger.warn('InferenceService: ONNX circuit opened — skipping inference for 5 min');
      this.metrics.onnxCircuitStateChange('open');
    });
    this.onnxBreaker.onReset(() => {
      this.logger.info('InferenceService: ONNX circuit closed — inference resumed');
      this.metrics.onnxCircuitStateChange('closed');
    });
  }

  private async init(): Promise<void> {
    if (!this.modelPath) {
      this.logger.warn('InferenceService: MODEL_PATH not set — ONNX inference disabled; rules engine will be used exclusively');
      return;
    }

    try {
      // Lazy import: if onnxruntime-node is not installed and MODEL_PATH is unset, startup succeeds.
      const ort = await import('onnxruntime-node');
      this.session = await ort.InferenceSession.create(this.modelPath);
      this.logger.info({ modelPath: this.modelPath }, 'InferenceService: ONNX model loaded');
    } catch (err) {
      this.logger.error({ err, modelPath: this.modelPath }, 'InferenceService: failed to load ONNX model — falling back to rules');
      this.session = null;
    }
  }

  /**
   * Runs ONNX inference with a hard 50 ms timeout.
   * Returns null when: model not loaded, timeout exceeded, or runtime error.
   * Null causes the orchestrator to fall back to rules output.
   */
  async predict(features: CustomerFeatures): Promise<InferenceResult | null> {
    await this.ready;
    if (!this.session) return null;

    const start = Date.now();
    try {
      const result = await this.onnxBreaker.execute(() =>
        Promise.race([this.runOnnx(features), this.timeout(50)]),
      );
      this.metrics.onnxInferenceDuration(Date.now() - start);
      return result;
    } catch (err) {
      if (err instanceof BrokenCircuitError) {
        // Circuit is open — fail silently; already logged on circuit-open event.
        return null;
      }
      this.logger.warn({ err }, 'InferenceService: inference error — falling back to rules');
      // Model was loaded but inference failed/timed out: track for reliability monitoring.
      this.metrics.onnxFallback();
      return null;
    }
  }

  private async runOnnx(features: CustomerFeatures): Promise<InferenceResult> {
    const ort = await import('onnxruntime-node');
    type OrtTensor = InstanceType<typeof ort.Tensor>;
    type RunOutput = Record<string, OrtTensor>;

    // Feature vector layout (must match ONNX model input schema):
    //   [0] abandonment_rate_7d     — 7-day cart abandonment rate for this customer
    //   [1] avg_cart_value_30d      — 30-day average cart value for this customer
    //   [2] SESSION_PAGE_DEPTH      — placeholder: page depth in current session (not yet computed)
    //   [3] SESSION_TIME_ON_PAGE_S  — placeholder: time on page in seconds (not yet computed)
    // TODO: populate [2] and [3] once enrichment-session exports these fields.
    const SESSION_PAGE_DEPTH_PLACEHOLDER = 0;
    const SESSION_TIME_ON_PAGE_S_PLACEHOLDER = 0;

    const inputData = new Float32Array([
      features.abandonment_rate_7d,
      features.avg_cart_value_30d,
      SESSION_PAGE_DEPTH_PLACEHOLDER,
      SESSION_TIME_ON_PAGE_S_PLACEHOLDER,
    ]);

    const inputTensor = new ort.Tensor('float32', inputData, [1, 4]);
    const feeds: Record<string, OrtTensor> = { features: inputTensor };
    const output = await (this.session as { run(f: Record<string, OrtTensor>): Promise<RunOutput> }).run(feeds);

    const confidenceTensor = output['confidence'];
    if (!confidenceTensor) throw new Error('ONNX output missing "confidence" node');

    const rawConfidence = (confidenceTensor.data as Float32Array)[0] ?? 0;

    // Clamp to [0, 1]. Values outside this range indicate a model misconfiguration.
    if (rawConfidence < 0 || rawConfidence > 1) {
      this.logger.warn(
        { rawConfidence },
        'InferenceService: ONNX confidence outside [0,1] — clamping; check model input schema',
      );
    }
    const confidence = Math.max(0, Math.min(1, rawConfidence));

    return { confidence };
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`ONNX inference timed out after ${ms}ms`)), ms),
    );
  }

  isEnabled(): boolean {
    return this.session !== null;
  }
}
