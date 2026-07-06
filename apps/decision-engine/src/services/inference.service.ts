import { createLogger } from '@org/logger';
import { circuitBreaker, ConsecutiveBreaker, handleAll } from 'cockatiel';
import type { FeatureVector, InterventionType, InterventionChannel } from '@org/types';
import { InferenceSession, type OnnxRuntime } from '@org/onnx-runtime';
import type { CustomerFeatures } from './features.service.js';
import type { DecisionMetrics } from '../metrics.js';

export interface InferenceResult {
  confidence: number;
  /**
   * Model-driven routing fields. Available once the ONNX model emits these outputs.
   * When absent, the rules engine determines type, channel, and value as fallback.
   */
  type?: InterventionType;
  channel?: InterventionChannel;
  value?: number;
}

/**
 * Ordered feature layout consumed by the ONNX risk-scoring model.
 * Field order MUST stay in sync with the training pipeline feature schema.
 * When a value is null/undefined, NaN is written (XGBoost missing-value handling).
 */
const FEATURE_ORDER = [
  // Customer history (ClickHouse aggregates)
  'abandonment_rate_7d',
  'avg_cart_value_30d',
  // Rolling aggregates (ZCOUNT on per-type sorted sets)
  'rage_clicks_30s',
  'add_to_cart_60s',
  'exit_intent_5m',
  // Recency
  'seconds_since_last_event',
  'seconds_since_last_add',
  'seconds_since_last_checkout',
  // EWMA velocity
  'ewma_events_per_minute',
  'ewma_scroll_velocity',
  'scroll_velocity_30s',
  // Pattern detection (bool → 0/1)
  'pattern_rage_after_add',
  'pattern_exit_after_checkout',
  'idle_after_high_cart',
  // Cart dynamics
  'cart_value_delta_2m',
  // Funnel progress
  'checkout_progress_max',
  'checkout_step_reached',
  // Session duration
  'time_on_site_total',
  // Behavioural entropy
  'unique_event_types',
  // Intervention history
  'interventions_shown_this_session',
  'seconds_since_last_intervention',
  // Cart composition (null until cart-items schema added)
  'cart_item_count',
  'cart_avg_item_price',
  'cart_has_discount',
  'cart_distinct_categories',
  // Funnel context (null until page-id schema added)
  'unique_pages_visited',
] as const;

type FeatureKey = (typeof FEATURE_ORDER)[number];

/** Merges window + customer features into a Float32Array. null/undefined → NaN for XGBoost. */
function buildFeatureArray(
  windowFeatures: FeatureVector | null | undefined,
  customerFeatures: CustomerFeatures,
): Float32Array {
  const merged: Record<string, number | boolean | null | undefined> = {
    abandonment_rate_7d: customerFeatures.abandonment_rate_7d,
    avg_cart_value_30d: customerFeatures.avg_cart_value_30d,
    ...(windowFeatures as unknown as Record<string, unknown> ?? {}),
  };

  const arr = new Float32Array(FEATURE_ORDER.length);
  for (let i = 0; i < FEATURE_ORDER.length; i++) {
    const raw = merged[FEATURE_ORDER[i] as FeatureKey];
    if (raw === null || raw === undefined) {
      arr[i] = NaN;
    } else if (typeof raw === 'boolean') {
      arr[i] = raw ? 1.0 : 0.0;
    } else {
      arr[i] = raw as number;
    }
  }
  return arr;
}

export class InferenceService {
  private readonly logger = createLogger({ service: 'InferenceService' });
  private inferenceSession: InferenceSession | null = null;
  private readonly ready: Promise<void>;
  /** Cockatiel circuit breaker — opens after 5 consecutive ONNX failures, resets after 5 min. */
  private readonly onnxBreaker = circuitBreaker(handleAll, {
    halfOpenAfter: 5 * 60_000,
    breaker: new ConsecutiveBreaker(5),
  });

  constructor(
    private readonly runtime: OnnxRuntime,
    private readonly modelPath: string | undefined,
    private readonly metrics: DecisionMetrics,
  ) {
    this.ready = this.init();
  }

  static from(runtime: OnnxRuntime, modelPath: string | undefined, metrics: DecisionMetrics): InferenceService {
    return new InferenceService(runtime, modelPath, metrics);
  }

  private async init(): Promise<void> {
    if (!this.modelPath) {
      this.logger.warn('InferenceService: MODEL_PATH not set — returning stub confidence 0.5 (rules will route)');
      return;
    }
    try {
      const session = await this.runtime.createSession(this.modelPath, {
        providers: [{ name: 'cpu' }],
      });
      this.inferenceSession = new InferenceSession(session, {
        timeoutMs: 50,
        circuitBreaker: this.onnxBreaker,
        callbacks: {
          onFallback: () => { this.metrics.onnxFallback(); },
          onCircuitOpen: () => {
            this.logger.warn('InferenceService: ONNX circuit opened — stub for 5 min');
            this.metrics.onnxCircuitStateChange('open');
          },
          onCircuitClosed: () => {
            this.logger.info('InferenceService: ONNX circuit closed — inference resumed');
            this.metrics.onnxCircuitStateChange('closed');
          },
        },
        warmup: true,
      });
      this.logger.info({ modelPath: this.modelPath }, 'InferenceService: risk model loaded');
    } catch (err) {
      this.logger.error({ err, modelPath: this.modelPath }, 'InferenceService: failed to load — using stub');
      this.inferenceSession = null;
    }
  }

  /**
   * Runs ONNX risk-score inference against the merged feature vector.
   *
   * Always returns a result (never null):
   *   - Model loaded + inference ok  → real confidence from ONNX output
   *   - Model not loaded / circuit open / timeout  → stub confidence 0.5
   *
   * Stub confidence (0.5) is below RISK_THRESHOLD (0.6), so the rules engine
   * remains authoritative for type/channel/value until a real model is deployed.
   */
  async predict(
    windowFeatures: FeatureVector | null | undefined,
    customerFeatures: CustomerFeatures,
  ): Promise<InferenceResult> {
    await this.ready;

    if (!this.inferenceSession) {
      return { confidence: 0.5 };
    }

    const inputData = buildFeatureArray(windowFeatures, customerFeatures);
    const dims = [1, FEATURE_ORDER.length];
    const start = Date.now();

    try {
      const output = await this.inferenceSession.predictFromArray('features', inputData, dims);
      this.metrics.onnxInferenceDuration(Date.now() - start);
      if (!output) return { confidence: 0.5 };
      return { confidence: Math.max(0, Math.min(1, output.confidence)) };
    } catch (err) {
      this.logger.warn({ err }, 'InferenceService: inference error — returning stub confidence');
      this.metrics.onnxFallback();
      return { confidence: 0.5 };
    }
  }

  isEnabled(): boolean {
    return this.inferenceSession !== null;
  }
}
