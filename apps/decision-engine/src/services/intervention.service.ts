import { createLogger } from '@org/logger';
import { createHash } from 'node:crypto';
import type {
  EnrichedEvent,
  InterventionType,
  InterventionChannel,
  InShopInterventionType,
  OffShopInterventionType,
  InShopPayload,
  NotificationRequest,
} from '@org/types';
import { InterventionWriter } from '../intervention/intervention.writer';
import { DecisionMetrics } from '../metrics';
import { BudgetService } from './budget.service';
import { CooldownService } from './cooldown.service';
import { DiscountService } from './discount.service';
import { ExperimentService } from './experiment.service';
import { FeatureService } from './features.service';
import { LockService } from './lock.service';
import { OutboundService } from './outbound.service';
import { PolicyService } from './policy.service';
import { PredictionService } from './prediction.service';
import { RecommendationService } from './recommendation.service';
import { RiskScorerService } from './risk-scorer.service';
import { SchedulerService } from './scheduler.service';
import { SessionFeaturesService } from './session-features.service';

/** In-shop types that carry a monetary offer → need a generated discount code. */
const NEEDS_DISCOUNT_CODE = new Set<string>(['price_reduction', 'free_shipping']);

/**
 * Deterministic UUID-like ID derived from SHA-256 of `{eid}|{distinctId}`.
 * Version nibble set to 5 for observability tooling compatibility.
 * Provides idempotency: re-processing the same source produces the same interventionId.
 */
function deterministicInterventionId(eid: string, distinctId: string): string {
  const hash = createHash('sha256').update(`${eid}|${distinctId}`).digest('hex');
  const variantNibble = (['8', '9', 'a', 'b'] as const)[parseInt(hash[16]!, 16) & 3]!;
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variantNibble}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Orchestrates the two-phase decision pipeline for a single enriched event.
 *
 * Phase 1 — Scoring + Recommendation:
 *   policy → cooldown gate → features
 *   → RiskScorerService.score() (rules + ONNX in parallel)
 *   → PredictionService.predict() (future abandonment)
 *   → threshold check (risk OR prediction > 0.6)
 *   → write recommendation to DB + Redis + Kafka
 *   → route based on approvalMode:
 *       auto_always      → executeRecommendation() immediately
 *       auto_if_budget   → peek budget; if ok → executeRecommendation(); else pending
 *       manual           → stop; admin approves via Admin API
 *
 * Phase 2 — Execution (via executeRecommendation):
 *   read recommendation → validate pending + not expired
 *   → isSent guard → lock + heartbeat → budget reserve → experiment → discount
 *   → write(delivered=false) → outbound → markDelivered → cooldown → markSent
 *   → markExecuted(recommendationId) → metrics
 *
 * Never throws — all errors are caught and logged.
 */
export class DecisionOrchestrator {
  private readonly logger = createLogger({ service: 'DecisionOrchestrator' });

  constructor(
    private readonly policy: PolicyService,
    private readonly cooldown: CooldownService,
    private readonly budget: BudgetService,
    private readonly features: FeatureService,
    private readonly riskScorer: RiskScorerService,
    private readonly experiment: ExperimentService,
    private readonly discount: DiscountService,
    private readonly outbound: OutboundService,
    private readonly writer: InterventionWriter,
    private readonly metrics: DecisionMetrics,
    private readonly lock: LockService,
    private readonly scheduler: SchedulerService,
    private readonly prediction: PredictionService,
    private readonly recommendation: RecommendationService,
    private readonly sessionFeatures: SessionFeaturesService,
  ) {}

  async decide(event: EnrichedEvent): Promise<void> {
    const t0 = Date.now();
    const distinctId = event.uid ?? event.anon;
    const storeId = event.store_id;
    const sessionId = event.sid;
    const customerId = event.customer_id;

    if (customerId === null) {
      this.logger.debug({ storeId, distinctId }, 'Skipping decision: customer_id not resolved');
      return;
    }

    try {
      // ── Phase 1: Risk Scoring ──────────────────────────────────────────────

      const pol = await this.policy.getPolicy(storeId);

      const onCooldown = await this.cooldown.isOnCooldown(storeId, customerId);
      if (onCooldown) {
        this.metrics.cooldownHit();
        return;
      }

      const feats = await this.features.getFeatures(storeId, distinctId);

      // Risk scoring and future prediction run in parallel.
      const [riskScore, predResult] = await Promise.all([
        this.riskScorer.score(event, feats, pol, customerId),
        this.prediction.predict(event.features, feats),
      ]);

      if (!riskScore) return; // Rules gate: cart too low, no valid channel, etc.

      // Threshold: current risk OR future prediction must exceed 0.6 to proceed.
      const PREDICTION_THRESHOLD = 0.6;
      const meetsThreshold =
        riskScore.shouldIntervene ||
        predResult.predictionProbability > PREDICTION_THRESHOLD;

      if (!meetsThreshold) {
        await this.scheduler.schedule(sessionId, riskScore.score);
        this.logger.debug(
          { sessionId, riskScore: riskScore.score, predProb: predResult.predictionProbability },
          'Below threshold — scheduled re-evaluation',
        );
        return;
      }

      // ── Generate recommendation ────────────────────────────────────────────

      const recId = await this.recommendation.generate({
        storeId,
        sessionId,
        distinctId,
        customerId,
        riskScore: riskScore.score,
        predictionProbability: predResult.predictionProbability,
        predictionConfidence: predResult.predictionConfidence,
        type: riskScore.type,
        channel: riskScore.channel,
        value: riskScore.value,
        triggerReason: event.t,
        featureSchemaVersion: event.features?.feature_schema_version,
        approvalTimeoutSeconds: pol?.approvalTimeoutSeconds ?? 600,
      });

      this.metrics.decisionLatency(Date.now() - t0);

      // ── Route based on approval mode ───────────────────────────────────────

      const approvalMode = pol?.approvalMode ?? 'manual';

      if (approvalMode === 'auto_always') {
        await this.executeRecommendation(recId);
      } else if (approvalMode === 'auto_if_budget') {
        const budgetOk = await this.budget.checkAvailable(
          storeId,
          riskScore.value,
          pol?.maxDailyBudgetAmount ?? 100,
        );
        if (budgetOk) {
          await this.executeRecommendation(recId);
        } else {
          this.logger.info({ recId, storeId }, 'auto_if_budget: budget peeked as insufficient — queued for approval');
        }
      } else {
        // manual: leave pending for admin
        this.logger.info(
          { recId, storeId, sessionId, riskScore: riskScore.score },
          'Recommendation pending admin approval',
        );
      }
    } catch (err) {
      this.logger.error({ err, storeId, sessionId, customerId }, 'DecisionOrchestrator.decide: unexpected error');
    }
  }

  /**
   * Executes an approved (or auto-approved) recommendation through Phase 2.
   *
   * Called from:
   *   - decide()     when approvalMode is auto_always or auto_if_budget (budget ok)
   *   - InternalHandler POST /internal/execute/:id  when admin approves via Admin API
   *
   * Returns the execution result so callers can surface it in HTTP responses.
   */
  async executeRecommendation(
    recommendationId: string,
  ): Promise<{ status: 'executed' | 'skipped'; interventionId?: string; reason?: string }> {
    const t0 = Date.now();

    let lockHeartbeat: NodeJS.Timeout | undefined;
    let lockToken: string | null = null;

    try {
      // Read and validate the recommendation
      const rec = await this.recommendation.get(recommendationId);
      if (!rec) {
        return { status: 'skipped', reason: 'recommendation_not_found' };
      }
      if (rec.status !== 'pending' && rec.status !== 'approved') {
        return { status: 'skipped', reason: `recommendation_status_${rec.status}` };
      }
      if (new Date() > rec.expiresAt) {
        await this.recommendation.markExpired(recommendationId, rec.storeId);
        return { status: 'skipped', reason: 'recommendation_expired' };
      }

      const { storeId, sessionId, distinctId, customerId, type, channel } = rec;
      const value = parseFloat(rec.value ?? '0');

      if (customerId === null) {
        return { status: 'skipped', reason: 'customer_not_resolved' };
      }

      // Read live session context for consent flags (may have changed since recommendation)
      const ctx = await this.sessionFeatures.getSessionContext(sessionId);

      const pol = await this.policy.getPolicy(storeId);

      // isSent guard
      if (await this.lock.isSent(customerId)) {
        return { status: 'skipped', reason: 'already_sent' };
      }

      // User-level lock
      lockToken = await this.lock.acquireUserLock(customerId);
      if (!lockToken) {
        return { status: 'skipped', reason: 'lock_contention' };
      }

      lockHeartbeat = setInterval(() => {
        if (!lockToken) return;
        void this.lock.renewUserLock(customerId, lockToken).then((stillValid) => {
          if (!stillValid) {
            this.logger.warn({ customerId, sessionId }, 'executeRecommendation: lock lost — fencing detected');
          }
        }).catch(() => {});
      }, 5_000);

      // Budget reserve
      const budgetOk = await this.budget.checkAndReserve(storeId, value, pol?.maxDailyBudgetAmount ?? 100);
      if (!budgetOk) {
        clearInterval(lockHeartbeat);
        await this.lock.releaseUserLock(customerId, lockToken);
        this.metrics.budgetExhausted();
        return { status: 'skipped', reason: 'budget_exhausted' };
      }

      // Experiment assignment
      const variant = await this.experiment.getVariant(storeId, customerId);

      // Discount code generation
      const intId = deterministicInterventionId(recommendationId, distinctId);
      let discountCode: string | null = null;
      if (NEEDS_DISCOUNT_CODE.has(type) && channel === 'in_shop') {
        discountCode = await this.discount.generateCode(storeId, sessionId, value, intId);
      }

      // Write intervention record (fire-and-forget before outbound)
      void this.writer.write({
        interventionId: intId,
        sessionId,
        storeId,
        customerId,
        distinctId,
        type: type as InterventionType,
        channel: channel as InterventionChannel,
        value,
        discountCode: discountCode ?? undefined,
        variant,
        triggerReason: rec.triggerReason ?? undefined,
        decisionLatencyMs: Date.now() - t0,
        confidenceScore: parseFloat(rec.riskScore),
      }).catch((err: unknown) => {
        this.logger.error({ err, interventionId: intId }, 'executeRecommendation: writer.write error');
      });

      // Outbound delivery
      if (channel === 'in_shop') {
        const payload: InShopPayload = {
          interventionId: intId,
          type: type as InShopInterventionType,
          value,
          discountCode: discountCode ?? undefined,
        };
        await this.outbound.route('in_shop', sessionId, payload);
      } else {
        const payload: NotificationRequest = {
          interventionId: intId,
          sessionId,
          storeId,
          distinctId,
          type: type as OffShopInterventionType,
          templateId: `${type}_default`,
          email: ctx?.email,
          emailConsent: ctx?.emailConsent ?? false,
          smsConsent: ctx?.smsConsent ?? false,
          templateData: {
            discountCode: discountCode ?? undefined,
            cartValue: ctx?.cartValue,
          },
        };
        await this.outbound.route('off_shop', sessionId, payload);
      }

      await this.writer.markDelivered(intId, channel as InterventionChannel);
      await this.cooldown.setCooldown(storeId, customerId, pol?.cooldownSeconds ?? 3600);
      await this.lock.markSent(customerId);
      await this.recommendation.markExecuted(recommendationId, intId);

      clearInterval(lockHeartbeat);
      await this.lock.releaseUserLock(customerId, lockToken);

      this.metrics.interventionTotal(type as InterventionType, channel as InterventionChannel, variant);

      this.logger.info(
        { interventionId: intId, recommendationId, type, channel, storeId, sessionId, customerId, latencyMs: Date.now() - t0 },
        'Recommendation executed — intervention dispatched',
      );

      return { status: 'executed', interventionId: intId };
    } catch (err) {
      clearInterval(lockHeartbeat);
      if (lockToken) {
        try { await this.lock.releaseUserLock(-1, lockToken); } catch { /* ignore */ }
      }
      this.logger.error({ err, recommendationId }, 'executeRecommendation: unexpected error');
      return { status: 'skipped', reason: String(err) };
    }
  }


  /**
   * Bypasses Phase 1 (risk scoring) and directly executes Phase 2 (intervention pipeline)
   * with admin-provided parameters. Respects budget and cooldown unless overrideCooldown.
   * Used by the internal admin endpoint POST /v1/internal/intervention/manual.
   */
  async manualDecide(params: {
    sessionId: string;
    storeId: number;
    customerId: number;
    distinctId: string;
    email?: string;
    emailConsent: boolean;
    smsConsent: boolean;
    type: InterventionType;
    channel: InterventionChannel;
    value: number;
    overrideCooldown?: boolean;
  }): Promise<{ interventionId: string | null; status: 'sent' | 'skipped' | 'error'; reason?: string }> {
    const t0 = Date.now();
    const { sessionId, storeId, customerId, distinctId, email, emailConsent, smsConsent, type, channel, value, overrideCooldown } = params;

    try {
      // Cooldown + sent-guard (skip if admin explicitly overrides)
      if (!overrideCooldown) {
        const onCooldown = await this.cooldown.isOnCooldown(storeId, customerId);
        if (onCooldown) {
          return { interventionId: null, status: 'skipped', reason: 'cooldown_active' };
        }
        if (await this.lock.isSent(customerId)) {
          return { interventionId: null, status: 'skipped', reason: 'already_sent' };
        }
      }

      // Acquire user-level lock (same path as all automated entry points per v2 spec §4.2)
      const manualToken = await this.lock.acquireUserLock(customerId);
      if (!manualToken) {
        return { interventionId: null, status: 'skipped', reason: 'lock_contention' };
      }

      let manualHeartbeat: NodeJS.Timeout | undefined;
      try {
      manualHeartbeat = setInterval(() => {
        void this.lock.renewUserLock(customerId, manualToken).catch(() => {});
      }, 5_000);
      // Policy (for budget limit)
      const pol = await this.policy.getPolicy(storeId);

      // Budget gate
      const budgetOk = await this.budget.checkAndReserve(storeId, value, pol?.maxDailyBudgetAmount ?? 100);
      if (!budgetOk) {
        return { interventionId: null, status: 'skipped', reason: 'budget_exhausted' };
      }

      // Experiment variant (fixed to control for manual admin-triggered interventions)
      const variant = 'control';

      // Deterministic ID using a unique manual eid
      const manualEid = `manual-${sessionId}-${Date.now()}-${customerId}`;
      const intId = deterministicInterventionId(manualEid, distinctId);

      // Discount code for monetary in-shop offers
      let discountCode: string | null = null;
      if (NEEDS_DISCOUNT_CODE.has(type) && channel === 'in_shop') {
        discountCode = await this.discount.generateCode(storeId, sessionId, value, intId);
      }

      // Write audit record (fire-and-forget)
      void this.writer.write({
        interventionId: intId,
        sessionId,
        storeId,
        customerId,
        distinctId,
        type,
        channel,
        value,
        discountCode: discountCode ?? undefined,
        variant,
        triggerReason: 'manual_admin',
        decisionLatencyMs: Date.now() - t0,
        confidenceScore: 1.0,
      }).catch((err: unknown) => {
        this.logger.error({ err, interventionId: intId }, 'manualDecide: writer.write error');
      });

      // Outbound delivery
      if (channel === 'in_shop') {
        const payload: InShopPayload = {
          interventionId: intId,
          type: type as InShopInterventionType,
          value,
          discountCode: discountCode ?? undefined,
        };
        await this.outbound.route('in_shop', sessionId, payload);
      } else {
        const payload: NotificationRequest = {
          interventionId: intId,
          sessionId,
          storeId,
          distinctId,
          type: type as OffShopInterventionType,
          templateId: `${type}_default`,
          email,
          emailConsent,
          smsConsent,
          templateData: { discountCode: discountCode ?? undefined },
        };
        await this.outbound.route('off_shop', sessionId, payload);
      }

      await this.writer.markDelivered(intId, channel);
      await this.cooldown.setCooldown(storeId, customerId, pol?.cooldownSeconds ?? 3600);
      await this.lock.markSent(customerId);
      clearInterval(manualHeartbeat);
      await this.lock.releaseUserLock(customerId, manualToken);
      this.metrics.interventionTotal(type, channel, variant);

      this.logger.info(
        { interventionId: intId, type, channel, storeId, sessionId, customerId, latencyMs: Date.now() - t0 },
        'Manual intervention dispatched',
      );
      return { interventionId: intId, status: 'sent' };
      } catch (innerErr) {
        clearInterval(manualHeartbeat);
        await this.lock.releaseUserLock(customerId, manualToken);
        throw innerErr;
      }
    } catch (err) {
      this.logger.error({ err, storeId, sessionId }, 'manualDecide: unexpected error');
      return { interventionId: null, status: 'error', reason: String(err) };
    }
  }
}

