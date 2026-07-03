import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireStoreAccess } from '../middleware/store-scope';
import type { AuthUser } from '../middleware/auth';

function makeApp(storeId: number) {
  const app = new Hono();
  // Seed user context manually (bypasses auth middleware for unit test)
  app.use('*', async (c, next) => {
    c.set('user', { userId: 1, roles: ['admin'], storeIds: [10, 20] } satisfies AuthUser);
    await next();
  });
  app.get(
    '/test',
    requireStoreAccess(() => storeId),
    (c) => c.json({ ok: true }),
  );
  return app;
}

describe('requireStoreAccess', () => {
  it('allows access when store_id is in user storeIds', async () => {
    const res = await makeApp(10).request('/test');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 403 when store_id is not in user storeIds (IDOR)', async () => {
    const res = await makeApp(99).request('/test');
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Forbidden');
  });

  it('returns 403 for store_id = 0 (falsy)', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('user', { userId: 1, roles: ['admin'], storeIds: [0] } satisfies AuthUser);
      await next();
    });
    app.get('/test', requireStoreAccess(() => null), (c) => c.json({ ok: true }));
    const res = await app.request('/test');
    expect(res.status).toBe(400);
  });
});
