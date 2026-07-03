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
import type { PolicyService } from '../policy/policy.service.js';
import type { CooldownService } from '../cooldown/cooldown.service.js';
import type { BudgetService } from '../budget/budget.service.js';
import type { FeatureService } from '../features/features.service.js';
import type { RiskScorerService } from '../risk/risk-scorer.service.js';
import type { ExperimentService } from '../experiment/experiment.service.js';
import type { DiscountService } from '../discount/discount.service.js';
import type { OutboundService } from '../outbound/outbound.service.js';
import type { InterventionWriter } from './intervention.writer.js';
import type { DecisionMetrics } from '../metrics.js';
import type { LockService } from '../lock/lock.service.js';
import type { SchedulerService } from '../scheduler/scheduler.service.js';

/** In-shop types that carry a monetary offer → need a generated discount code. */
const NEEDS_DISCOUNT_CODE = new Set<string>(['price_reduction', 'free_shipping']);

/**
 * Deterministic UUID-like ID derived from SHA-256 of `{eid}|{distinctId}`.
 * Version nibble set to 5 for observability tooling compatibility.
 * Provides Kafka-level idempotency: re-processing the same event produces the
 * same interventionId and will fail the DB unique constraint rather than
 * inserting a duplicate row.
 */
function deterministicInterventionId(eid: string, distinctId: string): string {
  const hash = createHash('sha256').update(`${eid}|${distinctId}`).digest('hex');
  // RFC 4122 variant nibble must be 8, 9, a, or b (top 2 bits = 10).
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
 * Phase 1 — Risk Scoring:
 *   policy → cooldown gate → features
 *   → RiskScorerService.score() (rules + ONNX in parallel)
 *   → write risk:{sid} → threshold check
 *   → score < 0.6: schedule re-evaluation and return
 *
 * Phase 2 — Intervention Pipeline:
 *   isSent guard → session lock → cart lock → budget gate
 *   → experiment → discount → write(delivered=false)
 *   → outbound → markDelivered → setCooldown → markSent → metrics
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
  ) {}

  async decide(event: EnrichedEvent): Promise<void> {
    const t0 = Date.now();
    const distinctId = event.uid ?? event.anon;
    const storeId = event.store_id;
    const sessionId = event.sid;
    const customerId = event.customer_id;

    // customer_id is required for identity-aware routing (cooldown, experiment bucketing).
    // If enrichment failed to resolve a customer (null), skip — the scheduler or stale
    // scanner will retry once the session hash is fully populated.
    if (customerId === null) {
      this.logger.debug({ storeId, distinctId }, 'Skipping decision: customer_id not resolved');
      return;
    }

    // Declared outside try so it is accessible in the catch block for cleanup.
    let lockHeartbeat: NodeJS.Timeout | undefined;

    try {
      // ── Phase 1: Risk Scoring ──────────────────────────────────────────────

      // 1. Policy
      const pol = await this.policy.getPolicy(storeId);

      // 2. Cooldown gate — fast Redis check before running inference
      const onCooldown = await this.cooldown.isOnCooldown(storeId, customerId);
      if (onCooldown) {
        this.metrics.cooldownHit();
        this.logger.debug({ storeId, customerId }, 'Cooldown active — skipping');
        return;
      }

      // 3. Features (needed by both rule engine and ONNX model)
      const feats = await this.features.getFeatures(storeId, distinctId);

      // 4. Risk scoring — rules engine + ONNX inference in parallel
      const riskScore = await this.riskScorer.score(event, feats, pol);
      if (!riskScore) {
        // Rules gate: cart too low, no valid delivery channel, etc.
        return;
      }

      // 5. Persist score for observability (fire-and-forget; non-blocking)
      void this.riskScorer.writeScore(sessionId, riskScore.score);

      // 6. Threshold gate
      if (!riskScore.shouldIntervene) {
        await this.scheduler.schedule(sessionId, riskScore.score);
        this.logger.debug(
          { sessionId, score: riskScore.score },
          'Risk below threshold — scheduled re-evaluation',
        );
        return;
      }

      // ── Phase 2: Intervention Pipeline ────────────────────────────────────

      // 7. isSent guard — cheap check before acquiring the session lock
      if (await this.lock.isSent(sessionId)) {
        this.logger.debug({ sessionId }, 'Intervention already sent in this window — skipping');
        return;
      }

      // 8. Session-level lock — prevents concurrent decisions for the same session
      const sessionLocked = await this.lock.acquireSessionLock(sessionId);
      if (!sessionLocked) {
        this.logger.debug({ sessionId }, 'Session lock contention — another decision in flight');
        return;
      }

      // Renew the lock every 5 s to prevent TTL expiry during slow pipeline execution
      // (outbound calls and DB writes can take 50–200 ms; 30 s TTL is sufficient under normal
      // load but the heartbeat provides a safety net under degraded conditions).
      lockHeartbeat = setInterval(() => {
        void this.lock.renewSessionLock(sessionId).catch(() => {});
      }, 5_000);

      // 9. Cart-level lock — prevents duplicate interventions across browser tabs
      const cartId = (event.props as Record<string, unknown> | undefined)?.['cart_id'] as string | undefined;
      if (cartId !== undefined) {
        const cartLocked = await this.lock.acquireCartLock(cartId);
        if (!cartLocked) {
          clearInterval(lockHeartbeat);
          this.logger.debug({ sessionId, cartId }, 'Cart lock contention — intervention in flight for cart');
          return;
        }
      }

      // 10. Budget gate — reserved only once we know an intervention will be sent
      const discountValue = pol?.discountValue ?? 10;
      const maxBudget = pol?.maxDailyBudgetAmount ?? 100;
      const budgetOk = await this.budget.checkAndReserve(storeId, discountValue, maxBudget);
      if (!budgetOk) {
        clearInterval(lockHeartbeat);
        this.metrics.budgetExhausted();
        this.logger.info({ storeId }, 'Budget exhausted — skipping');
        return;
      }

      const channel: InterventionChannel = riskScore.channel;

      // 11. Experiment assignment
      const variant = await this.experiment.getVariant(storeId, customerId);

      // 12. Discount code (only for monetary in-shop offers)
      const intId = deterministicInterventionId(event.eid, distinctId);
      let discountCode: string | null = null;
      if (NEEDS_DISCOUNT_CODE.has(riskScore.type) && channel === 'in_shop') {
        discountCode = await this.discount.generateCode(
          storeId,
          sessionId,
          riskScore.value,
          intId,
        );
      }

      // 13. Write record (delivered=false) — fire-and-forget so outbound delivery is not
      // blocked by the DB insert. Audit integrity is preserved via the Kafka DLQ in writer.
      void this.writer.write({
        interventionId: intId,
        sessionId,
        storeId,
        customerId,
        distinctId,
        type: riskScore.type,
        channel,
        value: riskScore.value,
        discountCode: discountCode ?? undefined,
        variant,
        triggerReason: event.t,
        decisionLatencyMs: Date.now() - t0,
        confidenceScore: riskScore.score,
      }).catch((err: unknown) => {
        this.logger.error({ err, interventionId: intId }, 'DecisionOrchestrator: writer.write fire-and-forget error');
      });

      // 14. Outbound delivery
      if (channel === 'in_shop') {
        const payload: InShopPayload = {
          interventionId: intId,
          type: riskScore.type as InShopInterventionType,
          value: riskScore.value,
          discountCode: discountCode ?? undefined,
        };
        await this.outbound.route('in_shop', sessionId, payload);
      } else {
        const payload: NotificationRequest = {
          interventionId: intId,
          sessionId,
          storeId,
          distinctId,
          type: riskScore.type as OffShopInterventionType,
          templateId: `${riskScore.type}_default`,
          email: event.email,
          emailConsent: event.email_consent,
          smsConsent: event.sms_consent,
          templateData: {
            discountCode: discountCode ?? undefined,
            cartValue: event.cart_value,
          },
        };
        await this.outbound.route('off_shop', sessionId, payload);
      }

      // 15. Mark delivered
      await this.writer.markDelivered(intId, channel);

      // 16. Set cooldown AFTER delivery confirmed
      await this.cooldown.setCooldown(storeId, customerId, pol?.cooldownSeconds ?? 3600);

      // 17. Persist sent-marker — prevents re-send for 5 min even after lock TTL expires
      await this.lock.markSent(sessionId);

      // 18. Metrics
      this.metrics.interventionTotal(riskScore.type, channel, variant);
      this.metrics.decisionLatency(Date.now() - t0);

      this.logger.info(
        {
          interventionId: intId,
          type: riskScore.type,
          channel,
          variant,
          storeId,
          sessionId,
          score: riskScore.score,
          latencyMs: Date.now() - t0,
        },
        'Intervention dispatched',
      );
      clearInterval(lockHeartbeat);
    } catch (err) {
      clearInterval(lockHeartbeat);
      this.logger.error({ err, storeId, sessionId }, 'DecisionOrchestrator: unexpected error (non-fatal)');
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
        if (await this.lock.isSent(sessionId)) {
          return { interventionId: null, status: 'skipped', reason: 'already_sent' };
        }
      }

      // Acquire session lock
      const sessionLocked = await this.lock.acquireSessionLock(sessionId);
      if (!sessionLocked) {
        return { interventionId: null, status: 'skipped', reason: 'lock_contention' };
      }

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
      await this.lock.markSent(sessionId);
      this.metrics.interventionTotal(type, channel, variant);

      this.logger.info(
        { interventionId: intId, type, channel, storeId, sessionId, latencyMs: Date.now() - t0 },
        'Manual intervention dispatched',
      );
      return { interventionId: intId, status: 'sent' };
    } catch (err) {
      this.logger.error({ err, storeId, sessionId }, 'manualDecide: unexpected error');
      return { interventionId: null, status: 'error', reason: String(err) };
    }
  }
}

