import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { requireStoreAccess } from '../middleware/store-scope';
import type { RedisClient } from '@org/redis_client';
import type { DecisionEngineClient } from '../clients/decision-engine';

export function createRiskRouter(redis: RedisClient, de: DecisionEngineClient) {
  const app = new Hono();

  // Get risk score for a single session
  app.get('/api/risk/:sessionId', authMiddleware, async (c) => {
    const sessionId = c.req.param('sessionId');
    const score = await redis.getRedis().get(`risk:${sessionId}`);
    if (score === null) return c.json({ statusCode: 404, error: 'Not Found', message: 'Session not found or expired' }, 404);
    return c.json({ sessionId, score: parseFloat(score) });
  });

  // List sessions for a user
  app.get(
    '/api/risk/user/:userId',
    authMiddleware,
    requireStoreAccess((c) => {
      const id = c.req.query('store_id');
      return id ? parseInt(id, 10) : null;
    }),
    async (c) => {
      const userId = c.req.param('userId');
      const sessionKeys = await redis.getRedis().keys(`session:${userId}:*`);
      const sessions = await Promise.all(
        sessionKeys.map(async (key) => {
          const sessionId = key.split(':')[2];
          const score = await redis.getRedis().get(`risk:${sessionId}`);
          return { sessionId, score: score ? parseFloat(score) : null };
        }),
      );
      return c.json(sessions);
    },
  );

  // Paginated active sessions sorted by risk score
  const activeSchema = z.object({
    store_id: z.coerce.number().int().positive(),
    limit: z.coerce.number().int().default(100),
    offset: z.coerce.number().int().default(0),
    min_score: z.coerce.number().default(0),
  });

  app.get(
    '/api/risk/active',
    authMiddleware,
    zValidator('query', activeSchema),
    requireStoreAccess((c) => c.req.valid('query').store_id),
    async (c) => {
      const { store_id, limit, offset, min_score } = c.req.valid('query');
      // ZREVRANGEBYSCORE: highest scores first, O(log N)
      const members = await redis.getRedis().zrevrangebyscore(
        `active_risk:${store_id}`,
        '+inf',
        min_score,
        'WITHSCORES',
        'LIMIT',
        offset,
        limit,
      );

      // members = [sessionId, score, sessionId, score, ...]
      const sessions: { sessionId: string; score: number }[] = [];
      for (let i = 0; i < members.length; i += 2) {
        sessions.push({ sessionId: members[i], score: parseFloat(members[i + 1]) });
      }

      return c.json({ sessions, count: sessions.length });
    },
  );

  // Force risk recalculation — proxied to Decision Engine
  app.post(
    '/api/risk/recalculate/:sessionId',
    authMiddleware,
    requireRole('admin', 'super-admin'),
    async (c) => {
      const sessionId = c.req.param('sessionId');
      const result = await de.recalculate(sessionId);
      return c.json(result);
    },
  );

  return app;
}
