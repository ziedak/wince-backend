import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import type { DecisionEngineClient } from '../clients/decision-engine';
import type { AuditService } from '../services/audit';

const interventionSchema = z.object({
  sessionId: z.string().uuid(),
  type: z.enum(['price_reduction', 'free_shipping', 'countdown', 'popup', 'urgency']),
  value: z.number().min(0),
  overrideCooldown: z.boolean().default(false),
});

export function createInterventionRouter(de: DecisionEngineClient, audit: AuditService) {
  const app = new Hono();

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

  return app;
}
