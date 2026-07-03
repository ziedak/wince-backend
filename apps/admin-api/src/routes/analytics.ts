import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { requireStoreAccess } from '../middleware/store-scope';
import type { ClickHouseClient } from '@org/clickhouse_client';

const rangeSchema = z.object({
  store_id: z.coerce.number().int().positive(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export function createAnalyticsRouter(ch: ClickHouseClient) {
  const app = new Hono();

  app.get(
    '/admin/analytics/recovery',
    authMiddleware,
    zValidator('query', rangeSchema),
    requireStoreAccess((c) => c.req.valid('query').store_id),
    async (c) => {
      const { store_id, from, to } = c.req.valid('query');
      const result = await ch.query({
        query: `
          SELECT
            toDate(timestamp) AS date,
            countIf(event_type = 'cart_abandoned') AS abandoned,
            countIf(event_type = 'purchase') AS recovered,
            round(countIf(event_type = 'purchase') / countIf(event_type = 'cart_abandoned') * 100, 2) AS recovery_rate
          FROM events
          WHERE store_id = {storeId: Int32}
            ${from ? 'AND timestamp >= {from: DateTime}' : ''}
            ${to ? 'AND timestamp <= {to: DateTime}' : ''}
          GROUP BY date
          ORDER BY date ASC
        `,
        query_params: { storeId: store_id, ...(from && { from }), ...(to && { to }) },
        format: 'JSONEachRow',
      });
      return c.json(await result.json());
    },
  );

  app.get(
    '/admin/analytics/revenue',
    authMiddleware,
    zValidator('query', rangeSchema),
    requireStoreAccess((c) => c.req.valid('query').store_id),
    async (c) => {
      const { store_id, from, to } = c.req.valid('query');
      const result = await ch.query({
        query: `
          SELECT
            intervention_type,
            count() AS total_interventions,
            countIf(converted = 1) AS conversions,
            sum(revenue_attributed) AS revenue
          FROM intervention_events
          WHERE store_id = {storeId: Int32}
            ${from ? 'AND timestamp >= {from: DateTime}' : ''}
            ${to ? 'AND timestamp <= {to: DateTime}' : ''}
          GROUP BY intervention_type
          ORDER BY revenue DESC
        `,
        query_params: { storeId: store_id, ...(from && { from }), ...(to && { to }) },
        format: 'JSONEachRow',
      });
      return c.json(await result.json());
    },
  );

  app.get(
    '/admin/analytics/heatmap',
    authMiddleware,
    zValidator('query', rangeSchema),
    requireStoreAccess((c) => c.req.valid('query').store_id),
    async (c) => {
      const { store_id, from, to } = c.req.valid('query');
      const result = await ch.query({
        query: `
          SELECT
            toDayOfWeek(timestamp) AS day_of_week,
            toHour(timestamp) AS hour,
            count() AS abandonment_count
          FROM events
          WHERE store_id = {storeId: Int32}
            AND event_type = 'cart_abandoned'
            ${from ? 'AND timestamp >= {from: DateTime}' : ''}
            ${to ? 'AND timestamp <= {to: DateTime}' : ''}
          GROUP BY day_of_week, hour
          ORDER BY day_of_week, hour
        `,
        query_params: { storeId: store_id, ...(from && { from }), ...(to && { to }) },
        format: 'JSONEachRow',
      });
      return c.json(await result.json());
    },
  );

  return app;
}
