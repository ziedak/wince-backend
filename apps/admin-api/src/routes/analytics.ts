import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { interventions, eq, and, gte, lte, sql as dsql } from '@org/db';
import { authMiddleware } from '../middleware/auth';
import { requireStoreAccess } from '../middleware/store-scope';
import type { DbClient } from '../types';
import type { ClickHouseClient } from '@org/clickhouse_client';

const rangeSchema = z.object({
  store_id: z.coerce.number().int().positive(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export function createAnalyticsRouter(db: DbClient, ch: ClickHouseClient) {
  const app = new Hono();

  app.get(
    '/admin/analytics/recovery',
    authMiddleware,
    zValidator('query', rangeSchema),
    requireStoreAccess((c) => c.req.valid('query').store_id),
    async (c) => {
      const { store_id, from, to } = c.req.valid('query');
      const rows = await ch.execute<Array<Record<string, unknown>>>(
        `
          SELECT
            toDate(timestamp) AS date,
            countIf(t = 'checkout_abandon') AS abandoned,
            countIf(t = 'purchase') AS recovered,
            round(countIf(t = 'purchase') / countIf(t = 'checkout_abandon') * 100, 2) AS recovery_rate
          FROM events
          WHERE store_id = {storeId: Int32}
            ${from ? 'AND timestamp >= {from: DateTime}' : ''}
            ${to ? 'AND timestamp <= {to: DateTime}' : ''}
          GROUP BY date
          ORDER BY date ASC
        `,
        { storeId: store_id, ...(from && { from }), ...(to && { to }) },
      );
      return c.json(rows);
    },
  );

  // NOTE: revenue/conversion attribution lives on the Postgres `interventions`
  // row (type/converted/revenue_attributed) written by decision-engine — the
  // ClickHouse intervention_events table has no such columns (it's a lifecycle
  // event log: shown/clicked/accepted/dismissed, not a revenue ledger).
  app.get(
    '/admin/analytics/revenue',
    authMiddleware,
    zValidator('query', rangeSchema),
    requireStoreAccess((c) => c.req.valid('query').store_id),
    async (c) => {
      const { store_id, from, to } = c.req.valid('query');
      const conditions = [eq(interventions.storeId, store_id)];
      if (from) conditions.push(gte(interventions.sentAt, new Date(from)));
      if (to) conditions.push(lte(interventions.sentAt, new Date(to)));

      const rows = await db
        .select({
          interventionType: interventions.type,
          totalInterventions: dsql<number>`count(*)`,
          conversions: dsql<number>`count(*) filter (where ${interventions.converted})`,
          revenue: dsql<number>`coalesce(sum(${interventions.revenueAttributed}), 0)`,
        })
        .from(interventions)
        .where(and(...conditions))
        .groupBy(interventions.type)
        .orderBy(dsql`revenue desc`);

      return c.json(rows);
    },
  );

  app.get(
    '/admin/analytics/heatmap',
    authMiddleware,
    zValidator('query', rangeSchema),
    requireStoreAccess((c) => c.req.valid('query').store_id),
    async (c) => {
      const { store_id, from, to } = c.req.valid('query');
      const rows = await ch.execute<Array<Record<string, unknown>>>(
        `
          SELECT
            toDayOfWeek(timestamp) AS day_of_week,
            toHour(timestamp) AS hour,
            count() AS abandonment_count
          FROM events
          WHERE store_id = {storeId: Int32}
            AND t = 'checkout_abandon'
            ${from ? 'AND timestamp >= {from: DateTime}' : ''}
            ${to ? 'AND timestamp <= {to: DateTime}' : ''}
          GROUP BY day_of_week, hour
          ORDER BY day_of_week, hour
        `,
        { storeId: store_id, ...(from && { from }), ...(to && { to }) },
      );
      return c.json(rows);
    },
  );

  return app;
}
