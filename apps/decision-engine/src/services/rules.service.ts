import type { EnrichedEvent, InterventionType, InterventionChannel } from '@org/types';
import { Policy } from './policy.service';
import { CustomerFeatures } from './features.service';


export interface RuleResult {
  shouldIntervene: boolean;
  channel: InterventionChannel;
  type: InterventionType;
  value: number;
  confidence: number;
}

type NoIntervention = { shouldIntervene: false };
type Intervention = { shouldIntervene: true } & RuleResult;

export type EvaluationResult = NoIntervention | Intervention;

export class RuleEngine {
  /**
   * Pure deterministic rule evaluation — no I/O, no side effects.
   * Returns the best rule-based intervention recommendation, or shouldIntervene=false.
   */
  evaluate(
    event: EnrichedEvent,
    features: CustomerFeatures,
    policy: Policy | null,
  ): EvaluationResult {
    const minCart = policy?.minCartValue ?? 10;
    const discountValue = policy?.discountValue ?? 10;
    const enableEmail = policy?.enableEmail ?? false;
    const enableSms = policy?.enableSms ?? false;

    // Gate: cart must have meaningful value
    if ((event.cart_value ?? 0) <= minCart) {
      return { shouldIntervene: false };
    }

    const highAbandonment = features.abandonment_rate_7d > 0.5;
    const frustrated = event.is_frustrated;

    // Off-shop: only when session is not active (no in-shop delivery possible)
    if (!event.session_available) {
      if (enableEmail && event.email_consent) {
        return {
          shouldIntervene: true,
          channel: 'off_shop',
          type: 'email',
          value: discountValue,
          confidence: 0.7,
        };
      }
      if (enableSms && event.sms_consent) {
        return {
          shouldIntervene: true,
          channel: 'off_shop',
          type: 'sms',
          value: discountValue,
          confidence: 0.6,
        };
      }
      return { shouldIntervene: false };
    }

    // In-shop: session is active — use WebSocket / pending delivery
    if (frustrated && highAbandonment) {
      return {
        shouldIntervene: true,
        channel: 'in_shop',
        type: 'price_reduction',
        value: discountValue,
        confidence: 0.85,
      };
    }

    if (highAbandonment) {
      return {
        shouldIntervene: true,
        channel: 'in_shop',
        type: 'free_shipping',
        value: 0,
        confidence: 0.7,
      };
    }

    if (frustrated) {
      return {
        shouldIntervene: true,
        channel: 'in_shop',
        type: 'countdown',
        value: discountValue,
        confidence: 0.55,
      };
    }

    // Low-signal: generic popup
    if ((event.cart_value ?? 0) > minCart * 3) {
      return {
        shouldIntervene: true,
        channel: 'in_shop',
        type: 'popup',
        value: discountValue,
        confidence: 0.45,
      };
    }

    return { shouldIntervene: false };
  }

  /**
   * Conservative fallback ladder for use when normal scoring cannot run
   * (Redis unavailable, ClickHouse down, model not loaded).
   *
   * Per v2 spec §4.1 step 7:
   *   cart > 3× minCartValue → 0.85
   *   rage_click_count > 2  → 0.70
   *   exit_intent event     → 0.60
   *   otherwise             → no intervention
   *
   * Fallback decisions always log source: 'fallback' on the audit record.
   */
  evaluateFallback(event: EnrichedEvent, policy: Policy | null): EvaluationResult {
    const minCart = policy?.minCartValue ?? 10;
    const discountValue = policy?.discountValue ?? 10;
    const cartValue = event.cart_value ?? 0;
    // Prefer in-shop when session is available, otherwise route off-shop
    const channel: InterventionChannel = event.session_available ? 'in_shop' : 'off_shop';
    const type = channel === 'in_shop' ? ('popup' as const) : ('email' as const);

    if (cartValue > minCart * 3) {
      return { shouldIntervene: true, channel, type, value: discountValue, confidence: 0.85 };
    }
    if ((event.rage_click_count ?? 0) > 2) {
      return { shouldIntervene: true, channel: 'in_shop', type: 'countdown', value: discountValue, confidence: 0.70 };
    }
    if (event.t === 'exit_intent') {
      return { shouldIntervene: true, channel: 'in_shop', type: 'popup', value: discountValue, confidence: 0.60 };
    }
    return { shouldIntervene: false };
  }
}
