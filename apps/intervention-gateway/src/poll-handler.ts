import { createLogger } from '@org/logger';
import type uWS from 'uWebSockets.js';
import type { InShopPayload } from '@org/types';
import type { RedisClient } from '@org/redis_client';
import type { GatewayMetrics } from './metrics.js';

const logger = createLogger({ service: 'PollHandler' });

/**
 * Handles GET /v1/interventions/pending?session_id (tracker.js REST poll fallback).
 *
 * Uses GETDEL to atomically fetch and delete the pending intervention so each
 * poll cycle consumes at most one intervention. Returns:
 *   { intervention: InShopPayload } — if a pending intervention exists
 *   { intervention: null }          — if nothing is queued
 */
export class PollHandler {
  constructor(
    private readonly redis: RedisClient,
    private readonly metrics: GatewayMetrics,
  ) {}

  handle(res: uWS.HttpResponse, sessionId: string): void {
    res.onAborted(() => undefined);

    void this.fetch(sessionId).then((intervention) => {
      res.cork(() => {
        res
          .writeStatus('200 OK')
          .writeHeader('Content-Type', 'application/json')
          .end(JSON.stringify({ intervention }));
      });
    });
  }

  private async fetch(sessionId: string): Promise<InShopPayload | null> {
    try {
      const raw = await this.redis.getRedis().getdel(`intervention:pending:${sessionId}`);
      if (!raw) return null;

      const payload = JSON.parse(raw) as InShopPayload;
      this.metrics.pendingDelivered('poll');
      logger.debug({ sessionId }, 'Pending intervention delivered via poll');
      return payload;
    } catch (err) {
      logger.warn({ err, sessionId }, 'PollHandler: fetch failed — returning null');
      return null;
    }
  }
}
