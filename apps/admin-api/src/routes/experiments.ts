import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { experiments, eq } from '@org/db';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { requireStoreAccess } from '../middleware/store-scope';
import type { AuditService } from '../services/audit';
import type { DbClient } from '../types';
import type { ClickHouseClient } from '@org/clickhouse_client';

const experimentSchema = z.object({
  storeId: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  variants: z.array(z.record(z.unknown())),
  metric: z.string().optional(),
  confidenceLevel: z.number().min(0).max(1).default(0.95),
});

export function createExperimentsRouter(db: DbClient, ch: ClickHouseClient, audit: AuditService) {
  const app = new Hono();

  app.get(
    '/admin/experiments',
    authMiddleware,
    requireStoreAccess((c) => {
      const id = c.req.query('store_id');
      return id ? parseInt(id, 10) : null;
    }),
    async (c) => {
      const storeId = parseInt(c.req.query('store_id')!, 10);
      const rows = await db.select().from(experiments).where(eq(experiments.storeId, storeId));
      return c.json(rows);
    },
  );

  app.post(
    '/admin/experiments',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    zValidator('json', experimentSchema),
    requireStoreAccess((c) => c.req.valid('json').storeId),
    async (c) => {
      const body = c.req.valid('json');
      const user = c.get('user');

      const [row] = await db
        .insert(experiments)
        .values({ ...body, startTime: new Date(body.startTime), endTime: body.endTime ? new Date(body.endTime) : undefined, variants: body.variants, active: true })
        .returning();

      await audit.log({ adminUserId: user.userId, storeId: body.storeId, action: 'create_experiment', target: body.name, success: true });
      return c.json(row, 201);
    },
  );

  app.put(
    '/admin/experiments/:id',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    zValidator('json', experimentSchema.partial()),
    async (c) => {
      const id = parseInt(c.req.param('id'), 10);
      const user = c.get('user');
      const body = c.req.valid('json');

      const [exp] = await db.select({ storeId: experiments.storeId }).from(experiments).where(eq(experiments.id, id)).limit(1);
      if (!exp) return c.json({ statusCode: 404, error: 'Not Found', message: 'Experiment not found' }, 404);
      if (!user.storeIds.includes(exp.storeId)) return c.json({ statusCode: 403, error: 'Forbidden', message: 'Access denied' }, 403);

      const updateData: Partial<typeof body & { startTime?: Date; endTime?: Date }> = { ...body };
      if (body.startTime) updateData.startTime = new Date(body.startTime);
      if (body.endTime) updateData.endTime = new Date(body.endTime);

      const [updated] = await db.update(experiments).set(updateData).where(eq(experiments.id, id)).returning();
      await audit.log({ adminUserId: user.userId, storeId: exp.storeId, action: 'update_experiment', target: String(id), success: true });
      return c.json(updated);
    },
  );

  app.delete(
    '/admin/experiments/:id',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    async (c) => {
      const id = parseInt(c.req.param('id'), 10);
      const user = c.get('user');

      const [exp] = await db.select({ storeId: experiments.storeId }).from(experiments).where(eq(experiments.id, id)).limit(1);
      if (!exp) return c.json({ statusCode: 404, error: 'Not Found', message: 'Experiment not found' }, 404);
      if (!user.storeIds.includes(exp.storeId)) return c.json({ statusCode: 403, error: 'Forbidden', message: 'Access denied' }, 403);

      await db.update(experiments).set({ active: false }).where(eq(experiments.id, id));
      await audit.log({ adminUserId: user.userId, storeId: exp.storeId, action: 'end_experiment', target: String(id), success: true });
      return c.json({ message: 'Experiment ended' });
    },
  );

  app.get(
    '/admin/experiments/:id/results',
    authMiddleware,
    async (c) => {
      const id = parseInt(c.req.param('id'), 10);
      const user = c.get('user');

      const [exp] = await db.select().from(experiments).where(eq(experiments.id, id)).limit(1);
      if (!exp) return c.json({ statusCode: 404, error: 'Not Found', message: 'Experiment not found' }, 404);
      if (!user.storeIds.includes(exp.storeId)) return c.json({ statusCode: 403, error: 'Forbidden', message: 'Access denied' }, 403);

      const results = await ch.query({
        query: `
          SELECT
            variant,
            count() AS total,
            countIf(converted = 1) AS conversions,
            round(countIf(converted = 1) / count() * 100, 2) AS conversion_rate,
            sum(revenue_attributed) AS revenue
          FROM experiment_results
          WHERE experiment_id = {experimentId: Int32}
          GROUP BY variant
        `,
        query_params: { experimentId: id },
        format: 'JSONEachRow',
      });

      return c.json(await results.json());
    },
  );

  return app;
}
