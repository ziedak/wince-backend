import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createDiscountRouter } from '../routes/discount';

function makeDb(discountRow: Record<string, unknown> | null, redeemRow: Record<string, unknown> | null) {
  const queryChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(discountRow ? [discountRow] : []),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(redeemRow ? [redeemRow] : []),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
  };
  return queryChain;
}

function makeRedis(rateCount = 1) {
  return {
    getRedis: () => ({
      incr: vi.fn().mockResolvedValue(rateCount),
      expire: vi.fn().mockResolvedValue(1),
    }),
  };
}

describe('POST /v1/redeem-discount', () => {
  it('returns 200 on first redemption', async () => {
    const db = makeDb(
      { code: 'SAVE10', discountType: 'percent', value: '10', minCartValue: null, expiresAt: new Date(Date.now() + 86400_000) },
      { code: 'SAVE10' },
    );
    const app = new Hono();
    app.route('/', createDiscountRouter(db as never, makeRedis() as never));
    const res = await app.request('/v1/redeem-discount', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'SAVE10', cart_total: 100, order_id: 'order-1' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 409 when code already used (atomic UPDATE returns empty)', async () => {
    const db = makeDb(
      { code: 'SAVE10', discountType: 'percent', value: '10', minCartValue: null, expiresAt: new Date(Date.now() + 86400_000) },
      null, // UPDATE returns nothing — already redeemed
    );
    const app = new Hono();
    app.route('/', createDiscountRouter(db as never, makeRedis() as never));
    const res = await app.request('/v1/redeem-discount', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'SAVE10', cart_total: 100, order_id: 'order-2' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 429 when rate limit exceeded', async () => {
    const db = makeDb(null, null);
    const app = new Hono();
    app.route('/', createDiscountRouter(db as never, makeRedis(21) as never));
    const res = await app.request('/v1/redeem-discount', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ code: 'SAVE10', cart_total: 100, order_id: 'order-3' }),
    });
    expect(res.status).toBe(429);
  });
});
