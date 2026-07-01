import { createLogger } from '@org/logger';
import { createHash } from 'node:crypto';
import type {
  EnrichedEvent,
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
import type { RuleEngine } from '../rules/rules.service.js';
import type { InferenceService } from '../inference/inference.service.js';
import type { ExperimentService } from '../experiment/experiment.service.js';
import type { DiscountService } from '../discount/discount.service.js';
import type { OutboundService } from '../outbound/outbound.service.js';
import type { InterventionWriter } from './intervention.writer.js';
import type { DecisionMetrics } from '../metrics.js';

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
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

/**
 * Orchestrates the full decision pipeline for a single enriched event.
 *
 * Pipeline:
 *   policy → cooldown gate → budget gate → features
 *   → Promise.all(rules, inference) → merge decision
 *   → experiment assignment → discount code
 *   → writer.write(delivered=false) → outbound.route
 *   → writer.markDelivered(true)
 *   → cooldown.setCooldown
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
    private readonly rules: RuleEngine,
    private readonly inference: InferenceService,
    private readonly experiment: ExperimentService,
    private readonly discount: DiscountService,
    private readonly outbound: OutboundService,
    private readonly writer: InterventionWriter,
    private readonly metrics: DecisionMetrics,
  ) {}

  async decide(event: EnrichedEvent): Promise<void> {
    const t0 = Date.now();
    const distinctId = event.uid ?? event.anon;
    const storeId = event.store_id;
    const sessionId = event.sid;
    const customerId = event.customer_id;

    // customer_id is required for identity-aware routing (cooldown, experiment bucketing).
    // If enrichment failed to resolve a customer (null), skip the decision — the event
    // will be reprocessed when the enrichment service recovers.
    if (customerId === null) {
      this.logger.debug({ storeId, distinctId }, 'Skipping decision: customer_id not resolved');
      return;
    }

    try {
      // ── 1. Policy ──────────────────────────────────────────────────────────
      const pol = await this.policy.getPolicy(storeId);

      // ── 2. Cooldown gate ───────────────────────────────────────────────────
      const onCooldown = await this.cooldown.isOnCooldown(storeId, customerId);
      if (onCooldown) {
        this.metrics.cooldownHit();
        this.logger.debug({ storeId, customerId }, 'Cooldown active — skipping');
        return;
      }

      // ── 3. Budget gate ─────────────────────────────────────────────────────
      const discountValue = pol?.discountValue ?? 10;
      const maxBudget = pol?.maxDailyBudgetAmount ?? 100;
      const budgetOk = await this.budget.checkAndReserve(storeId, discountValue, maxBudget);
      if (!budgetOk) {
        this.metrics.budgetExhausted();
        this.logger.info({ storeId }, 'Budget exhausted — skipping');
        return;
      }

      // ── 4. Features (needed by both rules + inference) ─────────────────────
      const feats = await this.features.getFeatures(storeId, distinctId);

      // ── 5. Rules + Inference in parallel ───────────────────────────────────
      const [ruleResult, inferenceResult] = await Promise.all([
        Promise.resolve(this.rules.evaluate(event, feats, pol)),
        this.inference.predict(feats),
      ]);

      if (!ruleResult.shouldIntervene) {
        return;
      }

      // ── 6. Merge decision ──────────────────────────────────────────────────
      // ONNX if confidence > 0.6 → use ONNX confidence (records richer signal);
      // otherwise fall back to rules confidence.
      // The type and channel are always determined by the rule engine.
      const finalConfidence =
        inferenceResult && inferenceResult.confidence > 0.6
          ? inferenceResult.confidence
          : ruleResult.confidence;

      const channel: InterventionChannel = ruleResult.channel;

      // ── 7. Experiment assignment ───────────────────────────────────────────
      const variant = await this.experiment.getVariant(storeId, customerId);

      // ── 8. Discount code ───────────────────────────────────────────────────
      const intId = deterministicInterventionId(event.eid, distinctId);
      let discountCode: string | null = null;
      if (NEEDS_DISCOUNT_CODE.has(ruleResult.type) && channel === 'in_shop') {
        discountCode = await this.discount.generateCode(
          storeId,
          sessionId,
          ruleResult.value,
          intId,
        );
      }

      // ── 9. Write record (delivered=false) BEFORE outbound ─────────────────
      await this.writer.write({
        interventionId: intId,
        sessionId,
        storeId,
        customerId,
        distinctId,
        type: ruleResult.type,
        channel,
        value: ruleResult.value,
        discountCode: discountCode ?? undefined,
        variant,
        decisionLatencyMs: Date.now() - t0,
        confidenceScore: finalConfidence,
      });

      // ── 10. Outbound delivery ──────────────────────────────────────────────
      if (channel === 'in_shop') {
        const payload: InShopPayload = {
          interventionId: intId,
          type: ruleResult.type as InShopInterventionType,
          value: ruleResult.value,
          discountCode: discountCode ?? undefined,
        };
        await this.outbound.route('in_shop', sessionId, payload);
      } else {
        const payload: NotificationRequest = {
          interventionId: intId,
          sessionId,
          storeId,
          distinctId,
          type: ruleResult.type as OffShopInterventionType,
          templateId: `${ruleResult.type}_default`,
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

      // ── 11. Mark delivered ─────────────────────────────────────────────────
      await this.writer.markDelivered(intId, channel);

      // ── 12. Set cooldown AFTER delivery confirmed ──────────────────────────
      await this.cooldown.setCooldown(storeId, customerId, pol?.cooldownSeconds ?? 3600);

      // ── 13. Metrics ────────────────────────────────────────────────────────
      this.metrics.interventionTotal(ruleResult.type, channel, variant);
      this.metrics.decisionLatency(Date.now() - t0);

      this.logger.info(
        {
          interventionId: intId,
          type: ruleResult.type,
          channel,
          variant,
          storeId,
          sessionId,
          latencyMs: Date.now() - t0,
        },
        'Intervention dispatched',
      );
    } catch (err) {
      this.logger.error({ err, storeId, sessionId }, 'DecisionOrchestrator: unexpected error (non-fatal)');
    }
  }
}
