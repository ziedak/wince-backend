import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { discountCodes, eq, and, isNull, gt, gte } from '@org/db';
import type { DbClient } from '../types';
import type { RedisClient } from '@org/redis_client';

const validateSchema = z.object({
  code: z.string().min(1),
  cart_total: z.coerce.number().positive(),
});

const redeemSchema = z.object({
  code: z.string().min(1),
  cart_total: z.number().positive(),
  order_id: z.string().min(1),
});

const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 20; // requests per window

export function createDiscountRouter(db: DbClient, redis: RedisClient) {
  const app = new Hono();

  // Per-IP rate limit helper
  async function checkRateLimit(ip: string): Promise<boolean> {
    const key = `rate:discount:${ip}`;
    const r = redis.getRedis();
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, RATE_LIMIT_WINDOW);
    return count <= RATE_LIMIT_MAX;
  }

  // Validate discount code (no auth — merchant checkout)
  app.get('/v1/validate-discount', zValidator('query', validateSchema), async (c) => {
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
    if (!(await checkRateLimit(ip))) {
      return c.json({ statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded' }, 429);
    }

    const { code, cart_total } = c.req.valid('query');

    const [discount] = await db
      .select()
      .from(discountCodes)
      .where(
        and(
          eq(discountCodes.code, code),
          isNull(discountCodes.usedAt),
          gt(discountCodes.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!discount) {
      return c.json({ valid: false, message: 'Invalid or expired code' });
    }

    const minCart = discount.minCartValue ? parseFloat(String(discount.minCartValue)) : 0;
    if (cart_total < minCart) {
      return c.json({ valid: false, message: `Minimum cart value is ${minCart}` });
    }

    const discountValue = discount.value ? parseFloat(String(discount.value)) : 0;
    const newTotal =
      discount.discountType === 'percent'
        ? Math.max(0, cart_total * (1 - discountValue / 100))
        : Math.max(0, cart_total - discountValue);

    return c.json({
      valid: true,
      discount_percent: discount.discountType === 'percent' ? discountValue : null,
      discount_fixed: discount.discountType === 'fixed' ? discountValue : null,
      discount_type: discount.discountType,
      new_total: Math.round(newTotal * 100) / 100,
    });
  });

  // Atomic redemption — prevents double-use
  app.post('/v1/redeem-discount', zValidator('json', redeemSchema), async (c) => {
    const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown';
    if (!(await checkRateLimit(ip))) {
      return c.json({ statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded' }, 429);
    }

    const { code, order_id } = c.req.valid('json');

    // Atomic claim: UPDATE ... WHERE used_at IS NULL — only succeeds once
    const [redeemed] = await db
      .update(discountCodes)
      .set({ usedAt: new Date(), usedInOrderId: order_id })
      .where(
        and(
          eq(discountCodes.code, code),
          isNull(discountCodes.usedAt),
          gt(discountCodes.expiresAt, new Date()),
        ),
      )
      .returning({ code: discountCodes.code });

    if (!redeemed) {
      return c.json({ statusCode: 409, error: 'Conflict', message: 'Code already used or expired' }, 409);
    }

    return c.json({ success: true, code });
  });

  return app;
}
