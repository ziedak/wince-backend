import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { stores, eq } from '@org/db';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { requireStoreAccess } from '../middleware/store-scope';
import type { KongClient } from '../clients/kong';
import type { AuditService } from '../services/audit';
import type { DbClient } from '../types';

const rateLimitSchema = z.object({ rateLimit: z.number().int().positive() });

export function createStoresRouter(db: DbClient, kong: KongClient, audit: AuditService) {
  const app = new Hono();

  // List all stores — super-admin only
  app.get('/admin/stores', authMiddleware, requireRole('super-admin'), async (c) => {
    const rows = await db.select().from(stores);
    return c.json(rows);
  });

  // Get a single store
  app.get(
    '/admin/stores/:id',
    authMiddleware,
    requireStoreAccess((c) => parseInt(c.req.param('id'), 10)),
    async (c) => {
      const id = parseInt(c.req.param('id'), 10);
      const [store] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
      if (!store) return c.json({ statusCode: 404, error: 'Not Found', message: 'Store not found' }, 404);
      return c.json(store);
    },
  );

  // Update rate limit
  app.put(
    '/admin/stores/:id/rate-limit',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    requireStoreAccess((c) => parseInt(c.req.param('id'), 10)),
    zValidator('json', rateLimitSchema),
    async (c) => {
      const id = parseInt(c.req.param('id'), 10);
      const { rateLimit } = c.req.valid('json');
      const user = c.get('user');
      const ip = c.req.header('x-forwarded-for');

      await db.update(stores).set({ rateLimit, updatedAt: new Date() }).where(eq(stores.id, id));
      await audit.log({ adminUserId: user.userId, storeId: id, action: 'update_rate_limit', target: String(id), details: { rateLimit }, success: true, ipAddress: ip });

      return c.json({ message: 'Rate limit updated' });
    },
  );

  // Regenerate API key
  app.post(
    '/admin/stores/:id/api-keys/regenerate',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    requireStoreAccess((c) => parseInt(c.req.param('id'), 10)),
    async (c) => {
      const id = parseInt(c.req.param('id'), 10);
      const user = c.get('user');
      const ip = c.req.header('x-forwarded-for');
      const kongUsername = `store-${id}`;
      const newKey = crypto.randomUUID();

      // Remove old Kong keys and provision new one
      const existingKeys = await kong.listApiKeys(kongUsername);
      for (const k of existingKeys) {
        await kong.deleteApiKey(kongUsername, k.id);
      }
      await kong.createApiKey(kongUsername, newKey);

      await audit.log({ adminUserId: user.userId, storeId: id, action: 'regenerate_api_key', success: true, ipAddress: ip });
      return c.json({ apiKey: newKey, message: 'API key regenerated. Store it securely — it will not be shown again.' }, 200);
    },
  );

  return app;
}
