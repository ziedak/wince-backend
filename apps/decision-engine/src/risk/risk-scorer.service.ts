import { createLogger } from '@org/logger';
import type { EnrichedEvent, InterventionType, InterventionChannel } from '@org/types';
import type { RedisClient } from '@org/redis_client';
import type { RuleEngine } from '../rules/rules.service.js';
import type { InferenceService } from '../inference/inference.service.js';
import type { CustomerFeatures } from '../features/features.service.js';
import type { Policy } from '../policy/policy.service.js';
import type { DecisionMetrics } from '../metrics.js';

/** Sessions with scores above this threshold proceed to the intervention pipeline. */
export const RISK_THRESHOLD = 0.6;

const RISK_SCORE_TTL_SECONDS = 60;

export interface RiskScore {
  score: number;
  /** True when score exceeds RISK_THRESHOLD and intervention should be triggered. */
  shouldIntervene: boolean;
  type: InterventionType;
  channel: InterventionChannel;
  value: number;
}

/**
 * Phase 1: Compute a continuous risk score (0–1) for an enriched event.
 *
 * Runs the deterministic rule engine and optional ONNX model in parallel.
 * ONNX confidence overrides rules confidence only when it exceeds the threshold,
 * providing a richer signal while falling back gracefully to rule-based scoring.
 * Type, channel, and value are always determined by the rule engine.
 */
export class RiskScorerService {
  private readonly logger = createLogger({ service: 'RiskScorerService' });

  constructor(
    private readonly rules: RuleEngine,
    private readonly inference: InferenceService,
    private readonly redis: RedisClient,
    private readonly metrics: DecisionMetrics,
  ) {}

  async score(
    event: EnrichedEvent,
    features: CustomerFeatures,
    policy: Policy | null,
  ): Promise<RiskScore | null> {
    const [ruleResult, inferenceResult] = await Promise.all([
      Promise.resolve(this.rules.evaluate(event, features, policy)),
      this.inference.predict(features),
    ]);

    if (!ruleResult.shouldIntervene) {
      // Rules gate (cart too low, no consent, etc.) — no intervention possible
      return null;
    }

    // ONNX confidence overrides rules when it exceeds the threshold.
    // Rules type/channel/value remain authoritative.
    const score =
      inferenceResult !== null && inferenceResult.confidence > RISK_THRESHOLD
        ? inferenceResult.confidence
        : ruleResult.confidence;

    // Track score distribution for observability (Prometheus histogram).
    this.metrics.riskScoreObserved(score);

    return {
      score,
      shouldIntervene: score > RISK_THRESHOLD,
      type: ruleResult.type,
      channel: ruleResult.channel,
      value: ruleResult.value,
    };
  }

  /** Persists the risk score for observability and downstream consumers. */
  async writeScore(sessionId: string, score: number): Promise<void> {
    try {
      await this.redis.getRedis().setex(`risk:${sessionId}`, RISK_SCORE_TTL_SECONDS, String(score));
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'RiskScorerService: failed to write score to Redis (non-fatal)');
    }
  }
}
