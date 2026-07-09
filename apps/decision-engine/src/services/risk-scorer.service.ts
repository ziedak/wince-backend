import { createLogger } from '@org/logger'
import type { RedisClient } from '@org/redis_client'
import type {
  EnrichedEvent,
  InterventionType,
  InterventionChannel,
} from '@org/types'
import { Policy } from './policy.service'
import type { DecisionMetrics } from '../metrics'
import { CustomerFeatures } from './features.service'
import { InferenceService } from './inference.service'
import { RuleEngine } from './rules.service'

/** Sessions with scores above this threshold proceed to the intervention pipeline. */
export const RISK_THRESHOLD = 0.6

/**
 * Maximum weight for a single session in the aggregate formula.
 * Prevents unbounded multiplication when several high-signal factors coincide.
 * Uncalibrated starting value — revisit after shadow-mode runs (v2 spec §4.1 step 5).
 */
const SESSION_WEIGHT_CAP = 20

/** TTL for the user-level aggregate risk score. */
const RISK_SCORE_TTL_SECONDS = 60

/** Sessions inactive longer than this are excluded from the aggregate. */
const SESSION_STALENESS_MS = 30 * 60 * 1_000 // 30 minutes

/** How long a user's session index is retained (covers max session lifetime). */
const USER_SESSIONS_TTL = 3600 // 1 hour

export interface RiskScore {
  score: number
  /** True when aggregate score meets or exceeds RISK_THRESHOLD. */
  shouldIntervene: boolean
  type: InterventionType
  channel: InterventionChannel
  value: number
  /** True when this score was produced by the conservative fallback ladder. */
  isFallback?: boolean
}

/**
 * Phase 1: Multi-session risk scoring for a resolved user.
 *
 * Algorithm (v2 spec §4.1):
 *   1. Register the current session in user_sessions:{userId}
 *   2. Fetch all active sessions for the user (pipelined multi-get)
 *   3. Compute per-session weight × risk contribution
 *   4. Aggregate: user_risk = Σ(weight × session_risk) / Σ weight
 *   5. Write risk:user:{userId} and active_risk:{storeId} (fire-and-forget)
 *
 * ONNX vs rules routing (v2 spec §4.1 step 6):
 *   If ONNX confidence > 0.6: ONNX determines type, channel, and value.
 *   Otherwise: rules engine is authoritative for all routing fields.
 *
 * Fallback (v2 spec §4.1 step 7):
 *   If scoring fails entirely (Redis/ClickHouse down), apply the conservative
 *   fallback ladder from rules.evaluateFallback() and log source: 'fallback'.
 */
export class RiskScorerService {
  private readonly logger = createLogger({ service: 'RiskScorerService' })

  constructor(
    private readonly rules: RuleEngine,
    private readonly inference: InferenceService,
    private readonly redis: RedisClient,
    private readonly metrics: DecisionMetrics
  ) {}

  async score(
    event: EnrichedEvent,
    features: CustomerFeatures,
    policy: Policy | null,
    userId: number
  ): Promise<RiskScore | null> {
    try {
      // ── 1. Register current session for multi-session tracking ──────────
      await this.registerSession(userId, event.sid, event.cart_value ?? 0)

      // ── 2. Compute triggering session score (rules + ONNX in parallel) ──
      const [ruleResult, rawInferenceResult] = await Promise.all([
        Promise.resolve(this.rules.evaluate(event, features, policy)),
        this.inference.predict(event.features, features),
      ])

      // Rules gate: cart too low, no consent channel, etc.
      if (!ruleResult.shouldIntervene) {
        return null
      }

      // InferenceService.predict() is documented to never resolve null/undefined
      // (it returns a stub confidence 0.5 when the model isn't loaded). Guard
      // anyway: treating a contract violation as "zero confidence" lets the
      // rules engine take over exactly as it does for the documented stub case,
      // instead of the whole request incorrectly falling into the catastrophic
      // fallback ladder below (which is reserved for Redis/ClickHouse outages).
      const inferenceResult = rawInferenceResult ?? { confidence: 0 }

      // ── 3. Determine routing: ONNX overrides rules when confidence > 0.6 ─
      const onnxDriven =
        inferenceResult.confidence > RISK_THRESHOLD &&
        inferenceResult.type !== undefined &&
        inferenceResult.channel !== undefined

      const triggerScore =
        inferenceResult.confidence > RISK_THRESHOLD
          ? inferenceResult.confidence
          : ruleResult.confidence

      const resolvedType: InterventionType = onnxDriven
        ? inferenceResult.type!
        : ruleResult.type
      const resolvedChannel: InterventionChannel = onnxDriven
        ? inferenceResult.channel!
        : ruleResult.channel
      const resolvedValue: number =
        onnxDriven && inferenceResult.value !== undefined
          ? inferenceResult.value
          : ruleResult.value

      // ── 4. Multi-session weighted aggregate ────────────────────────────
      const userRisk = await this.aggregateUserRisk(
        userId,
        event.sid,
        triggerScore,
        event.cart_value ?? 0
      )

      this.metrics.riskScoreObserved(userRisk)

      // ── 5. Persist (fire-and-forget — non-blocking) ────────────────────
      void this.writeUserRisk(userId, event.store_id, userRisk)

      return {
        score: userRisk,
        shouldIntervene: userRisk >= RISK_THRESHOLD,
        type: resolvedType,
        channel: resolvedChannel,
        value: resolvedValue,
      }
    } catch (err) {
      // ── Fallback ladder (v2 spec §4.1 step 7) ─────────────────────────
      this.logger.warn(
        { err, userId, sid: event.sid },
        'RiskScorerService: scoring error — applying fallback ladder'
      )
      const fallback = this.rules.evaluateFallback(event, policy)
      if (!fallback.shouldIntervene) return null
      const fallbackScore = fallback.confidence
      this.metrics.riskScoreObserved(fallbackScore)
      void this.writeUserRisk(userId, event.store_id, fallbackScore)
      return {
        score: fallbackScore,
        shouldIntervene: fallbackScore >= RISK_THRESHOLD,
        type: fallback.type,
        channel: fallback.channel,
        value: fallback.value,
        isFallback: true,
      }
    }
  }

  /**
   * Computes the weighted aggregate risk across all active sessions for a user.
   * The triggering session uses the freshly computed score; sibling sessions use
   * a heuristic approximated from their stored Redis hash fields.
   */
  private async aggregateUserRisk(
    userId: number,
    triggerSid: string,
    triggerScore: number,
    triggerCartValue: number
  ): Promise<number> {
    const raw = this.redis.getRedis()

    // Get all active session IDs for this user
    const cutoff = Date.now() - SESSION_STALENESS_MS
    let sessionIds: string[]
    try {
      sessionIds = await raw.zrangebyscore(
        `user_sessions:${userId}`,
        cutoff,
        '+inf'
      )
    } catch {
      // If session index unavailable, fall back to single-session score
      return triggerScore
    }

    if (sessionIds.length === 0) {
      return triggerScore
    }

    // Pipeline-fetch all session hashes
    const pipeline = raw.pipeline()
    for (const sid of sessionIds) {
      pipeline.hgetall(`session:${sid}`)
    }

    let hashes: Array<Record<string, string> | null>
    try {
      const results = await pipeline.exec()
      hashes = (results ?? []).map(
        ([, v]) => v as Record<string, string> | null
      )
    } catch {
      return triggerScore
    }

    let weightedSum = 0
    let totalWeight = 0

    for (let i = 0; i < sessionIds.length; i++) {
      const sid = sessionIds[i]!
      const hash = hashes[i]
      if (!hash || Object.keys(hash).length === 0) continue

      const cartValue = parseFloat(hash['cart_value'] ?? '0') || 0
      const rageClicks = parseInt(hash['rage_click_count'] ?? '0', 10) || 0
      const lastActivity = parseInt(hash['last_activity'] ?? '0', 10) || 0
      const isFrustrated = hash['is_frustrated'] === '1'

      const minutesSinceActive =
        lastActivity > 0 ? (Date.now() - lastActivity) / 60_000 : 999

      // Weight formula (v2 spec §4.1 step 5)
      // Omitted factors (checkout_progress, scroll_depth, time_on_page, device_type)
      // default to neutral 0 until enrichment-session writes those fields.
      let weight =
        1.0 *
        (1 + 0.5 * Math.log(cartValue + 1)) *
        (1 + 0.2 * rageClicks) *
        (1 + 0.5 * Math.exp(-minutesSinceActive / 10))

      weight = Math.min(weight, SESSION_WEIGHT_CAP)

      // Session risk: live score for triggering session, heuristic for siblings
      const sessionRisk =
        sid === triggerSid
          ? triggerScore
          : this.heuristicRisk(isFrustrated, rageClicks, cartValue)

      weightedSum += weight * sessionRisk
      totalWeight += weight
    }

    if (totalWeight === 0) return triggerScore

    const aggregateRisk = weightedSum / totalWeight
    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, aggregateRisk))
  }

  /**
   * Approximates the risk score for a sibling session from its hash fields.
   * Used when the session wasn't the trigger for the current scoring cycle.
   */
  private heuristicRisk(
    isFrustrated: boolean,
    rageClicks: number,
    cartValue: number
  ): number {
    if (isFrustrated && rageClicks > 2) return 0.85
    if (isFrustrated) return 0.7
    if (rageClicks > 2) return 0.65
    if (cartValue > 0) return 0.5
    return 0.35
  }

  /**
   * Registers a session in the user's session index (user_sessions:{userId} ZSET).
   * Score = current timestamp for recency-based filtering.
   * Prunes sessions inactive for > SESSION_STALENESS_MS to bound the set size.
   */
  private async registerSession(
    userId: number,
    sessionId: string,
    cartValue: number
  ): Promise<void> {
    const key = `user_sessions:${userId}`
    const now = Date.now()
    const cutoff = now - SESSION_STALENESS_MS
    try {
      await this.redis
        .getRedis()
        .pipeline()
        .zadd(key, now, sessionId)
        .zremrangebyscore(key, 0, cutoff)
        .expire(key, USER_SESSIONS_TTL)
        .exec()
    } catch (err) {
      this.logger.warn(
        { err, userId, sessionId },
        'RiskScorerService: registerSession failed (non-fatal)'
      )
    }
    void cartValue // suppress unused warning; used for future weight pre-computation
  }

  /**
   * Writes the aggregate user risk score to Redis (fire-and-forget).
   * Also updates active_risk:{storeId} sorted set for Admin API pagination.
   */
  async writeUserRisk(
    userId: number,
    storeId: number,
    score: number
  ): Promise<void> {
    try {
      await this.redis
        .getRedis()
        .pipeline()
        .setex(`risk:user:${userId}`, RISK_SCORE_TTL_SECONDS, String(score))
        .zadd(`active_risk:${storeId}`, score, String(userId))
        .exec()
    } catch (err) {
      this.logger.warn(
        { err, userId, storeId },
        'RiskScorerService: writeUserRisk failed (non-fatal)'
      )
    }
  }
}
