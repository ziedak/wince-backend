import { createLogger } from '@org/logger';
import type { CustomerFeatures } from '../features/features.service.js';
import type { DecisionMetrics } from '../metrics.js';

export interface InferenceResult {
  confidence: number;
}

export class InferenceService {
  private readonly logger = createLogger({ service: 'InferenceService' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private session: any | null = null;
  private readonly ready: Promise<void>;

  constructor(
    private readonly modelPath: string | undefined,
    private readonly metrics: DecisionMetrics,
  ) {
    this.ready = this.init();
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
      const result = await Promise.race([
        this.runOnnx(features),
        this.timeout(50),
      ]);
      this.metrics.onnxInferenceDuration(Date.now() - start);
      return result;
    } catch (err) {
      this.logger.warn({ err }, 'InferenceService: inference error');
      return null;
    }
  }

  private async runOnnx(features: CustomerFeatures): Promise<InferenceResult> {
    const ort = await import('onnxruntime-node');
    type OrtTensor = InstanceType<typeof ort.Tensor>;
    type RunOutput = Record<string, OrtTensor>;

    const inputData = new Float32Array([
      features.abandonment_rate_7d,
      features.avg_cart_value_30d,
      0, // placeholder
      0, // placeholder
    ]);

    const inputTensor = new ort.Tensor('float32', inputData, [1, 4]);
    const feeds: Record<string, OrtTensor> = { features: inputTensor };
    const output = await (this.session as { run(f: Record<string, OrtTensor>): Promise<RunOutput> }).run(feeds);

    const confidenceTensor = output['confidence'];
    if (!confidenceTensor) throw new Error('ONNX output missing "confidence" node');

    const confidence = (confidenceTensor.data as Float32Array)[0] ?? 0;
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
