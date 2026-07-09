import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RiskScorerService, RISK_THRESHOLD } from './risk-scorer.service.js';
import type { EnrichedEvent } from '@org/types';
import type { CustomerFeatures } from './features.service.js';
import type { Policy } from './policy.service.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EnrichedEvent> = {}): EnrichedEvent {
  return {
    eid: 'test-eid',
    seq: 1,
    t: 'exit_intent',
    ts: Date.now(),
    sid: 'sid-1',
    anon: 'anon-id',
    uid: undefined,
    store_id: 1,
    source: 'browser',
    server_received_at: Date.now(),
    adjusted_ts: Date.now(),
    ip: '1.2.3.4',
    customer_id: 42,
    cart_value: 80,
    rage_click_count: 0,
    is_frustrated: true,
    lifetime_value: 0,
    email_consent: false,
    sms_consent: false,
    session_available: true,
    ...overrides,
  } as EnrichedEvent;
}

const features: CustomerFeatures = { abandonment_rate_7d: 0.7, avg_cart_value_30d: 100 };
const policy = {
  minCartValue: 10,
  discountValue: 15,
  maxDailyBudgetAmount: 100,
  cooldownSeconds: 3600,
  enableEmail: true,
  enableSms: false,
} as Policy;

function makeRules(shouldIntervene = true, confidence = 0.75) {
  return {
    evaluate: vi.fn(() => ({
      shouldIntervene,
      channel: 'in_shop' as const,
      type: 'price_reduction' as const,
      value: 15,
      confidence,
    })),
    evaluateFallback: vi.fn(() => ({
      shouldIntervene: true,
      channel: 'in_shop' as const,
      type: 'popup' as const,
      value: 15,
      confidence: 0.65,
    })),
  };
}

function makeInference(result: { confidence: number; type?: string; channel?: string; value?: number } | null = null) {
  return { predict: vi.fn(async () => result) };
}

/**
 * Creates a Redis mock that fully supports the ioredis pipeline API used by the risk scorer:
 *   - pipeline().zadd/zremrangebyscore/expire/setex/hgetall  (chaining, returns pipe)
 *   - pipeline().exec()  returns [[null, value], ...] pairs
 *   - zrangebyscore: returns session IDs for user_sessions:{userId}
 *   - hgetall (direct, for potential future use)
 */
function makeRedis(sessionHashes: Record<string, Record<string, string>> = {}) {
  // Default session hash for sid-1
  const defaultHashes: Record<string, Record<string, string>> = {
    'session:sid-1': {
      cart_value: '80',
      rage_click_count: '0',
      last_activity: String(Date.now() - 30_000),
      is_frustrated: '1',
      store_id: '1',
      distinct_id: 'anon-id',
      customer_id: '42',
    },
    ...sessionHashes,
  };

  function makePipeline() {
    const hgetallKeys: string[] = [];
    const pipe = {
      zadd: vi.fn((..._args: unknown[]) => pipe),
      zremrangebyscore: vi.fn((..._args: unknown[]) => pipe),
      expire: vi.fn((..._args: unknown[]) => pipe),
      setex: vi.fn((..._args: unknown[]) => pipe),
      hgetall: vi.fn((key: string) => { hgetallKeys.push(key); return pipe; }),
      exec: vi.fn(async () => {
        return hgetallKeys.map((k) => [null, defaultHashes[k] ?? null]);
      }),
    };
    return pipe;
  }

  // Memoize so all calls to getRedis() return the same spy-instrumented instance
  const rawRedis = {
    pipeline: vi.fn(() => makePipeline()),
    zrangebyscore: vi.fn(async (key: string, _min: number, _max: number) => {
      if (key.startsWith('user_sessions:')) return ['sid-1'];
      return [];
    }),
    zrange: vi.fn(async (key: string) => {
      if (key.startsWith('user_sessions:')) return ['sid-1'];
      return [];
    }),
    hgetall: vi.fn(async (key: string) => defaultHashes[key] ?? null),
  };

  return { getRedis: () => rawRedis };
}

const makeMetrics = () => ({
  riskScoreObserved: vi.fn(),
  featureDegraded: vi.fn(),
  onnxFallback: vi.fn(),
  dbOperation: vi.fn(),
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('RiskScorerService.score', () => {
  it('returns null when rules gate blocks (cart too low, etc.)', async () => {
    const rules = makeRules(false);
    const svc = new RiskScorerService(
      rules as never, makeInference() as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent(), features, policy, 42);
    expect(result).toBeNull();
  });

  it('returns a RiskScore with shouldIntervene=true when aggregate score >= threshold', async () => {
    const rules = makeRules(true, 0.85);
    const svc = new RiskScorerService(
      rules as never, makeInference() as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent(), features, policy, 42);
    expect(result).not.toBeNull();
    expect(result!.shouldIntervene).toBe(true);
    expect(result!.score).toBeGreaterThanOrEqual(RISK_THRESHOLD);
  });

  it('score is a valid probability in [0, 1]', async () => {
    const rules = makeRules(true, 0.75);
    const svc = new RiskScorerService(
      rules as never, makeInference() as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent(), features, policy, 42);
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThanOrEqual(0);
    expect(result!.score).toBeLessThanOrEqual(1);
  });

  it('uses ONNX type/channel/value when confidence > 0.6 and model outputs routing fields', async () => {
    const rules = makeRules(true, 0.5);
    const onnxResult = {
      confidence: 0.92,
      type: 'free_shipping' as const,
      channel: 'in_shop' as const,
      value: 0,
    };
    const svc = new RiskScorerService(
      rules as never, makeInference(onnxResult) as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent(), features, policy, 42);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('free_shipping');
    expect(result!.channel).toBe('in_shop');
    expect(result!.value).toBe(0);
  });

  it('falls back to rules type/channel/value when ONNX confidence <= 0.6', async () => {
    const rules = makeRules(true, 0.80);
    const onnxResult = { confidence: 0.55 }; // below threshold — no routing fields
    const svc = new RiskScorerService(
      rules as never, makeInference(onnxResult) as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent(), features, policy, 42);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('price_reduction'); // from rules
    expect(result!.channel).toBe('in_shop');
  });

  it('falls back to rules type/channel/value when ONNX returns null (model unavailable)', async () => {
    const rules = makeRules(true, 0.75);
    const svc = new RiskScorerService(
      rules as never, makeInference(null) as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent(), features, policy, 42);
    expect(result!.type).toBe('price_reduction');
  });

  it('does NOT use ONNX routing when confidence > 0.6 but type/channel fields are absent', async () => {
    // Model emits high confidence but hasn't been extended to output type/channel yet (Open Item #12)
    const rules = makeRules(true, 0.70);
    const onnxResult = { confidence: 0.90 }; // high confidence, but no type/channel
    const svc = new RiskScorerService(
      rules as never, makeInference(onnxResult) as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent(), features, policy, 42);
    expect(result).not.toBeNull();
    // Should fall back to rules for routing since ONNX type/channel are undefined
    expect(result!.type).toBe('price_reduction');
  });

  it('applies conservative fallback ladder when rules.evaluate() throws', async () => {
    // The outer catch in score() fires when the synchronous rules.evaluate() throws,
    // simulating a corrupt policy config or unexpected input shape.
    const throwingRules = {
      evaluate: vi.fn(() => { throw new Error('Policy config corrupt'); }),
      evaluateFallback: vi.fn(() => ({
        shouldIntervene: true,
        channel: 'in_shop' as const,
        type: 'popup' as const,
        value: 15,
        confidence: 0.85,
      })),
    };
    const svc = new RiskScorerService(
      throwingRules as never, makeInference() as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent({ t: 'exit_intent', cart_value: 50 }), features, policy, 42);
    expect(result).not.toBeNull();
    expect(result!.isFallback).toBe(true);
    expect(throwingRules.evaluateFallback).toHaveBeenCalledOnce();
  });

  it('returns null from fallback when no fallback condition matches', async () => {
    const throwingRules = {
      evaluate: vi.fn(() => { throw new Error('Scoring down'); }),
      evaluateFallback: vi.fn(() => ({ shouldIntervene: false })),
    };
    const svc = new RiskScorerService(
      throwingRules as never, makeInference() as never, makeRedis() as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent({ cart_value: 5 }), features, policy, 42);
    expect(result).toBeNull();
  });

  it('aggregates across multiple sessions: high-risk sibling boosts aggregate', async () => {
    const multiSessionRedis = {
      getRedis: () => ({
        pipeline: vi.fn(() => {
          const hgetallKeys: string[] = [];
          const pipe = {
            zadd: vi.fn(() => pipe),
            zremrangebyscore: vi.fn(() => pipe),
            expire: vi.fn(() => pipe),
            setex: vi.fn(() => pipe),
            hgetall: vi.fn((key: string) => { hgetallKeys.push(key); return pipe; }),
            exec: vi.fn(async () => hgetallKeys.map((k) => {
              const hashes: Record<string, Record<string, string>> = {
                'session:sid-1': { cart_value: '80', rage_click_count: '5', last_activity: String(Date.now() - 10_000), is_frustrated: '1' },
                'session:sid-2': { cart_value: '120', rage_click_count: '3', last_activity: String(Date.now() - 20_000), is_frustrated: '1' },
              };
              return [null, hashes[k] ?? null];
            })),
          };
          return pipe;
        }),
        zrangebyscore: vi.fn(async () => ['sid-1', 'sid-2']),
        zrange: vi.fn(async () => ['sid-1', 'sid-2']),
        hgetall: vi.fn(async () => null),
      }),
    };

    const rules = makeRules(true, 0.75);
    const svc = new RiskScorerService(
      rules as never, makeInference() as never, multiSessionRedis as never, makeMetrics() as never,
    );
    const result = await svc.score(makeEvent(), features, policy, 42);
    expect(result).not.toBeNull();
    // Two high-risk sessions should yield a combined score still in [0,1]
    expect(result!.score).toBeGreaterThanOrEqual(0);
    expect(result!.score).toBeLessThanOrEqual(1);
    expect(result!.isFallback).toBeUndefined();
  });

  it('records the aggregate risk score via metrics', async () => {
    const metrics = makeMetrics();
    const rules = makeRules(true, 0.80);
    const svc = new RiskScorerService(
      rules as never, makeInference() as never, makeRedis() as never, metrics as never,
    );
    await svc.score(makeEvent(), features, policy, 42);
    expect(metrics.riskScoreObserved).toHaveBeenCalledTimes(1);
    const [observedScore] = metrics.riskScoreObserved.mock.calls[0] as [number];
    expect(observedScore).toBeGreaterThan(0);
    expect(observedScore).toBeLessThanOrEqual(1);
  });
});

describe('RiskScorerService.writeUserRisk', () => {
  it('writes risk:user:{userId} and active_risk:{storeId} via pipeline without throwing', async () => {
    const redis = makeRedis();
    const svc = new RiskScorerService(
      makeRules() as never, makeInference() as never, redis as never, makeMetrics() as never,
    );
    await expect(svc.writeUserRisk(42, 1, 0.75)).resolves.toBeUndefined();
    const raw = redis.getRedis(); // same memoized instance
    expect(raw.pipeline).toHaveBeenCalled();
    // Verify correct keys are written in the pipeline
    const pipeMock = (raw.pipeline as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      setex: ReturnType<typeof vi.fn>;
      zadd: ReturnType<typeof vi.fn>;
    };
    expect(pipeMock.setex).toHaveBeenCalledWith('risk:user:42', expect.any(Number), '0.75');
    expect(pipeMock.zadd).toHaveBeenCalledWith('active_risk:1', 0.75, '42');
  });
});

