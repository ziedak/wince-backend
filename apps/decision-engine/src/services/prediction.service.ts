import { createLogger } from '@org/logger';
import { circuitBreaker, ConsecutiveBreaker, handleAll } from 'cockatiel';
import { InferenceSession, type OnnxRuntime } from '@org/onnx-runtime';
import type { FeatureVector } from '@org/types';
import type { CustomerFeatures } from './features.service.js';
import type { DecisionMetrics } from '../metrics.js';

export interface PredictionResult {
  /** Probability of cart abandonment within the configured horizon (T minutes). */
  predictionProbability: number;
  /** Model confidence for the prediction; 0 when using stub. */
  predictionConfidence: number;
}

/**
 * Runs ONNX inference for the future-abandonment prediction model.
 *
 * This is a separate model from the risk-scoring model, trained on
 * `will_abandon_in_T_minutes` labels. It consumes the same feature vector
 * layout as the risk model (see InferenceService.FEATURE_ORDER).
 *
 * Stub mode (PREDICTION_MODEL_PATH not set):
 *   Returns { predictionProbability: 0.5, predictionConfidence: 0.0 }.
 *   This is below the 0.6 threshold so the risk score alone gates interventions
 *   until the real prediction model is trained and deployed.
 */
export class PredictionService {
  private readonly logger = createLogger({ service: 'PredictionService' });
  private inferenceSession: InferenceSession | null = null;
  private readonly ready: Promise<void>;
  private readonly breaker = circuitBreaker(handleAll, {
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

  private async init(): Promise<void> {
    if (!this.modelPath) {
      this.logger.warn('PredictionService: PREDICTION_MODEL_PATH not set — returning stub (0.5, 0.0)');
      return;
    }
    try {
      const session = await this.runtime.createSession(this.modelPath, {
        providers: [{ name: 'cpu' }],
      });
      this.inferenceSession = new InferenceSession(session, {
        timeoutMs: 50,
        circuitBreaker: this.breaker,
        callbacks: {
          onFallback: () => { this.metrics.onnxFallback(); },
          onCircuitOpen: () => {
            this.logger.warn('PredictionService: circuit opened — stub for 5 min');
          },
          onCircuitClosed: () => {
            this.logger.info('PredictionService: circuit closed — inference resumed');
          },
        },
        warmup: true,
      });
      this.logger.info({ modelPath: this.modelPath }, 'PredictionService: prediction model loaded');
    } catch (err) {
      this.logger.error({ err, modelPath: this.modelPath }, 'PredictionService: failed to load — using stub');
      this.inferenceSession = null;
    }
  }

  /**
   * Predicts the probability of cart abandonment within the horizon T.
   * Always returns a PredictionResult; uses stub values when model is not ready.
   *
   * Feature layout must match InferenceService.FEATURE_ORDER (training-serving parity).
   * TODO: import shared FEATURE_ORDER constant once co-located in a shared module.
   */
  async predict(
    windowFeatures: FeatureVector | null | undefined,
    customerFeatures: CustomerFeatures,
  ): Promise<PredictionResult> {
    await this.ready;

    if (!this.inferenceSession) {
      return { predictionProbability: 0.5, predictionConfidence: 0.0 };
    }

    // Feature array layout mirrors FEATURE_ORDER from InferenceService.
    // Both models share the same schema — only training labels differ.
    const merged: Record<string, number | boolean | null | undefined> = {
      abandonment_rate_7d: customerFeatures.abandonment_rate_7d,
      avg_cart_value_30d: customerFeatures.avg_cart_value_30d,
      ...(windowFeatures as unknown as Record<string, unknown> ?? {}),
    };

    const FIELDS = [
      'abandonment_rate_7d', 'avg_cart_value_30d',
      'rage_clicks_30s', 'add_to_cart_60s', 'exit_intent_5m',
      'seconds_since_last_event', 'seconds_since_last_add', 'seconds_since_last_checkout',
      'ewma_events_per_minute', 'ewma_scroll_velocity', 'scroll_velocity_30s',
      'pattern_rage_after_add', 'pattern_exit_after_checkout', 'idle_after_high_cart',
      'cart_value_delta_2m', 'checkout_progress_max', 'checkout_step_reached',
      'time_on_site_total', 'unique_event_types',
      'interventions_shown_this_session', 'seconds_since_last_intervention',
      'cart_item_count', 'cart_avg_item_price', 'cart_has_discount',
      'cart_distinct_categories', 'unique_pages_visited',
    ];

    const arr = new Float32Array(FIELDS.length);
    for (let i = 0; i < FIELDS.length; i++) {
      const raw = merged[FIELDS[i]!];
      if (raw === null || raw === undefined) { arr[i] = NaN; }
      else if (typeof raw === 'boolean') { arr[i] = raw ? 1.0 : 0.0; }
      else { arr[i] = raw as number; }
    }

    const start = Date.now();
    try {
      const output = await this.inferenceSession.predictFromArray('features', arr, [1, FIELDS.length]);
      this.metrics.onnxInferenceDuration(Date.now() - start);
      if (!output) return { predictionProbability: 0.5, predictionConfidence: 0.0 };
      const prob = Math.max(0, Math.min(1, output.confidence));
      return { predictionProbability: prob, predictionConfidence: prob };
    } catch (err) {
      this.logger.warn({ err }, 'PredictionService: inference error — returning stub');
      this.metrics.onnxFallback();
      return { predictionProbability: 0.5, predictionConfidence: 0.0 };
    }
  }
}
