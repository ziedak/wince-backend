import { describe, it, expect } from 'vitest';
import { RuleEngine } from './rules.service.js';
import type { EnrichedEvent } from '@org/types';
import type { CustomerFeatures } from '../features/features.service.js';
import type { Policy } from '../policy/policy.service.js';

function makeEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return {
    eid: 'test-eid',
    seq: 1,
    t: 'exit_intent',
    ts: Date.now(),
    sid: 'test-sid',
    anon: 'anon-id',
    store_id: 1,
    source: 'browser',
    server_received_at: Date.now(),
    adjusted_ts: Date.now(),
    ip: '1.2.3.4',
    customer_id: 100,
    cart_value: 50,
    rage_click_count: 0,
    is_frustrated: false,
    lifetime_value: 0,
    email_consent: false,
    sms_consent: false,
    session_available: true,
    ...overrides,
  } as EnrichedEvent;
}

const features: CustomerFeatures = { abandonment_rate_7d: 0, avg_cart_value_30d: 0 };
const policy: Policy = {
  minCartValue: 10,
  discountValue: 15,
  maxDailyBudgetAmount: 100,
  cooldownSeconds: 3600,
  enableEmail: true,
  enableSms: false,
} as Policy;

describe('RuleEngine.evaluate', () => {
  const engine = new RuleEngine();

  it('blocks when cart value is below minCartValue', () => {
    const result = engine.evaluate(makeEvent({ cart_value: 5 }), features, policy);
    expect(result.shouldIntervene).toBe(false);
  });

  it('returns price_reduction for frustrated high-abandonment in-shop user', () => {
    const highAbandonFeatures: CustomerFeatures = { abandonment_rate_7d: 0.8, avg_cart_value_30d: 100 };
    const result = engine.evaluate(
      makeEvent({ is_frustrated: true, session_available: true }),
      highAbandonFeatures,
      policy,
    );
    expect(result.shouldIntervene).toBe(true);
    if (result.shouldIntervene) {
      expect(result.type).toBe('price_reduction');
      expect(result.channel).toBe('in_shop');
    }
  });

  it('routes off-shop when session is not available and email consent granted', () => {
    const result = engine.evaluate(
      makeEvent({ session_available: false, email_consent: true }),
      features,
      policy,
    );
    expect(result.shouldIntervene).toBe(true);
    if (result.shouldIntervene) {
      expect(result.channel).toBe('off_shop');
      expect(result.type).toBe('email');
    }
  });

  it('blocks off-shop when email and sms both disabled', () => {
    const noConsentPolicy = { ...policy, enableEmail: false, enableSms: false } as Policy;
    const result = engine.evaluate(
      makeEvent({ session_available: false }),
      features,
      noConsentPolicy,
    );
    expect(result.shouldIntervene).toBe(false);
  });
});

describe('RuleEngine.evaluateFallback', () => {
  const engine = new RuleEngine();

  it('returns 0.85 confidence for cart > 3× minCartValue (in-shop)', () => {
    const result = engine.evaluateFallback(
      makeEvent({ cart_value: 50, session_available: true }),
      policy, // minCartValue = 10, so 50 > 30 = true
    );
    expect(result.shouldIntervene).toBe(true);
    if (result.shouldIntervene) {
      expect(result.confidence).toBe(0.85);
      expect(result.channel).toBe('in_shop');
    }
  });

  it('returns 0.70 confidence for rage_click_count > 2', () => {
    const result = engine.evaluateFallback(
      makeEvent({ cart_value: 15, rage_click_count: 3 }),
      policy,
    );
    expect(result.shouldIntervene).toBe(true);
    if (result.shouldIntervene) {
      expect(result.confidence).toBe(0.70);
      expect(result.type).toBe('countdown');
    }
  });

  it('returns 0.60 confidence for exit_intent event', () => {
    const result = engine.evaluateFallback(
      makeEvent({ cart_value: 15, t: 'exit_intent', session_available: true }),
      { ...policy, minCartValue: 20 } as Policy, // cart < minCart*3 to skip first branch
    );
    expect(result.shouldIntervene).toBe(true);
    if (result.shouldIntervene) {
      expect(result.confidence).toBe(0.60);
    }
  });

  it('returns no intervention when no signals match', () => {
    const result = engine.evaluateFallback(
      makeEvent({ cart_value: 15, rage_click_count: 0, t: 'idle_timeout' }),
      { ...policy, minCartValue: 20 } as Policy,
    );
    expect(result.shouldIntervene).toBe(false);
  });

  it('routes off-shop when session_available is false', () => {
    const result = engine.evaluateFallback(
      makeEvent({ cart_value: 50, session_available: false }),
      policy,
    );
    expect(result.shouldIntervene).toBe(true);
    if (result.shouldIntervene) {
      expect(result.channel).toBe('off_shop');
    }
  });
});
