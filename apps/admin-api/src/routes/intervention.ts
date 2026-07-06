import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import type { DecisionEngineClient } from '../clients/decision-engine';
import type { AuditService } from '../services/audit';
import type { RecommendationReadService } from '../services/recommendation';

const interventionSchema = z.object({
  sessionId: z.string().uuid(),
  type: z.enum(['price_reduction', 'free_shipping', 'countdown', 'popup', 'urgency']),
  value: z.number().min(0),
  overrideCooldown: z.boolean().default(false),
});

const recommendationPatchSchema = z.object({
  type: z.enum(['price_reduction', 'free_shipping', 'countdown', 'popup', 'urgency']).optional(),
  channel: z.enum(['in_shop', 'email', 'sms', 'push']).optional(),
  value: z.number().min(0).optional(),
});

const storeSettingsSchema = z.object({
  approvalMode: z.enum(['manual', 'auto_if_budget', 'auto_always']).optional(),
  approvalTimeoutSeconds: z.number().int().min(60).max(86400).optional(),
  budgetMode: z.enum(['per_day', 'per_campaign', 'unlimited']).optional(),
});

export function createInterventionRouter(
  de: DecisionEngineClient,
  audit: AuditService,
  recommendations: RecommendationReadService,
) {
  const app = new Hono();

  // ── Existing: admin manual trigger ────────────────────────────────────────
  app.post(
    '/api/intervention/manual',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    zValidator('json', interventionSchema),
    async (c) => {
      const body = c.req.valid('json');
      const user = c.get('user');
      const ip = c.req.header('x-forwarded-for');

      let result;
      try {
        result = await de.manualIntervention(body);
      } catch {
        await audit.log({ adminUserId: user.userId, action: 'manual_intervention', target: body.sessionId, details: { type: body.type }, success: false, ipAddress: ip });
        return c.json({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to reach decision engine' }, 500);
      }

      const success = result.status === 'sent';
      await audit.log({
        adminUserId: user.userId,
        action: 'manual_intervention',
        target: body.sessionId,
        details: { type: body.type, value: body.value, overrideCooldown: body.overrideCooldown, result },
        success,
        ipAddress: ip,
      });

      const httpStatus = result.status === 'error' ? 422 : 200;
      return c.json(result, httpStatus);
    },
  );

  // ── GET /admin/interventions/recommendations ───────────────────────────────
  app.get(
    '/admin/interventions/recommendations',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    async (c) => {
      const storeId = c.req.query('store_id') ? parseInt(c.req.query('store_id')!, 10) : undefined;
      const status = c.req.query('status') ?? undefined;
      const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
      const offset = parseInt(c.req.query('offset') ?? '0', 10);

      if (storeId !== undefined && isNaN(storeId)) {
        return c.json({ error: 'invalid store_id' }, 400);
      }

      const rows = await recommendations.list({ storeId, status, limit, offset });
      return c.json({ data: rows, limit, offset });
    },
  );

  // ── POST /admin/interventions/recommendations/:id/approve ─────────────────
  app.post(
    '/admin/interventions/recommendations/:id/approve',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    async (c) => {
      const id = c.req.param('id');
      const user = c.get('user');
      const ip = c.req.header('x-forwarded-for');

      const rec = await recommendations.get(id);
      if (!rec) return c.json({ error: 'not_found' }, 404);
      if (rec.status !== 'pending') return c.json({ error: 'not_pending', current: rec.status }, 409);
      if (new Date() > rec.expiresAt) return c.json({ error: 'expired' }, 410);

      let result;
      try {
        result = await de.executeRecommendation(id);
      } catch {
        await audit.log({ adminUserId: user.userId, action: 'approve_recommendation', target: id, details: { storeId: rec.storeId }, success: false, ipAddress: ip });
        return c.json({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to reach decision engine' }, 500);
      }

      await audit.log({
        adminUserId: user.userId,
        action: 'approve_recommendation',
        target: id,
        details: { storeId: rec.storeId, result },
        success: result.status === 'executed',
        ipAddress: ip,
      });

      return c.json(result, result.status === 'executed' ? 200 : 202);
    },
  );

  // ── POST /admin/interventions/recommendations/:id/reject ──────────────────
  app.post(
    '/admin/interventions/recommendations/:id/reject',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    async (c) => {
      const id = c.req.param('id');
      const user = c.get('user');
      const ip = c.req.header('x-forwarded-for');

      const rec = await recommendations.get(id);
      if (!rec) return c.json({ error: 'not_found' }, 404);
      if (rec.status !== 'pending') return c.json({ error: 'not_pending', current: rec.status }, 409);

      await recommendations.reject(id, user.userId);

      await audit.log({
        adminUserId: user.userId,
        action: 'reject_recommendation',
        target: id,
        details: { storeId: rec.storeId },
        success: true,
        ipAddress: ip,
      });

      return c.json({ status: 'rejected' });
    },
  );

  // ── PUT /admin/interventions/recommendations/:id ──────────────────────────
  app.put(
    '/admin/interventions/recommendations/:id',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    zValidator('json', recommendationPatchSchema),
    async (c) => {
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const user = c.get('user');
      const ip = c.req.header('x-forwarded-for');

      const rec = await recommendations.get(id);
      if (!rec) return c.json({ error: 'not_found' }, 404);
      if (rec.status !== 'pending') return c.json({ error: 'not_pending', current: rec.status }, 409);

      await recommendations.patch(id, body);

      await audit.log({
        adminUserId: user.userId,
        action: 'patch_recommendation',
        target: id,
        details: { storeId: rec.storeId, patch: body },
        success: true,
        ipAddress: ip,
      });

      return c.json({ status: 'updated' });
    },
  );

  // ── PUT /admin/stores/:store_id/settings ──────────────────────────────────
  app.put(
    '/admin/stores/:store_id/settings',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    zValidator('json', storeSettingsSchema),
    async (c) => {
      const storeId = parseInt(c.req.param('store_id'), 10);
      const body = c.req.valid('json');
      const user = c.get('user');
      const ip = c.req.header('x-forwarded-for');

      if (isNaN(storeId)) return c.json({ error: 'invalid store_id' }, 400);
      if (Object.keys(body).length === 0) return c.json({ error: 'no fields to update' }, 400);

      await recommendations.upsertStoreSettings(storeId, body);

      await audit.log({
        adminUserId: user.userId,
        action: 'update_store_settings',
        target: String(storeId),
        details: { settings: body },
        success: true,
        ipAddress: ip,
      });

      return c.json({ status: 'updated' });
    },
  );

  return app;
}
