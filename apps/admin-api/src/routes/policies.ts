import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { policyRules, eq, and } from '@org/db';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { requireStoreAccess } from '../middleware/store-scope';
import type { AuditService } from '../services/audit';
import type { DbClient } from '../types';

const policySchema = z.object({
  storeId: z.number().int().positive(),
  ruleType: z.enum(['cooldown_minutes', 'max_discount_percent', 'daily_budget_limit', 'min_cart_value']),
  parameters: z.record(z.unknown()),
  enabled: z.boolean().default(true),
});

export function createPoliciesRouter(db: DbClient, audit: AuditService) {
  const app = new Hono();

  app.get(
    '/admin/policies',
    authMiddleware,
    requireStoreAccess((c) => {
      const id = c.req.query('store_id');
      return id ? parseInt(id, 10) : null;
    }),
    async (c) => {
      const storeId = parseInt(c.req.query('store_id')!, 10);
      const rows = await db.select().from(policyRules).where(eq(policyRules.storeId, storeId));
      return c.json(rows);
    },
  );

  app.put(
    '/admin/policies',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    zValidator('json', policySchema),
    requireStoreAccess((c) => c.req.valid('json').storeId),
    async (c) => {
      const body = c.req.valid('json');
      const user = c.get('user');

      const [row] = await db
        .insert(policyRules)
        .values({ storeId: body.storeId, ruleType: body.ruleType, parameters: body.parameters, enabled: body.enabled })
        .onConflictDoUpdate({ target: [policyRules.storeId, policyRules.ruleType], set: { parameters: body.parameters, enabled: body.enabled, updatedAt: new Date() } })
        .returning();

      await audit.log({ adminUserId: user.userId, storeId: body.storeId, action: 'upsert_policy', target: body.ruleType, success: true });
      return c.json(row);
    },
  );

  app.delete(
    '/admin/policies/:id',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    async (c) => {
      const id = parseInt(c.req.param('id'), 10);
      const user = c.get('user');

      const [rule] = await db.select({ storeId: policyRules.storeId }).from(policyRules).where(eq(policyRules.id, id)).limit(1);
      if (!rule) return c.json({ statusCode: 404, error: 'Not Found', message: 'Policy not found' }, 404);

      if (!user.storeIds.includes(rule.storeId)) {
        return c.json({ statusCode: 403, error: 'Forbidden', message: 'Access denied' }, 403);
      }

      await db.delete(policyRules).where(and(eq(policyRules.id, id), eq(policyRules.storeId, rule.storeId)));
      await audit.log({ adminUserId: user.userId, storeId: rule.storeId, action: 'delete_policy', target: String(id), success: true });
      return c.json({ message: 'Policy deleted' });
    },
  );

  return app;
}
