import * as http from 'node:http';
import { createLogger } from '@org/logger';
import type { InterventionType, InterventionChannel } from '@org/types';
import { DecisionOrchestrator, SessionFeaturesService } from '../services';

/**
 * Handles internal admin endpoints — never exposed through Kong.
 * Protected by X-Internal-Secret shared secret (same as /v1/trigger).
 *
 * Routes:
 *   POST /v1/internal/recalculate           — re-run decision for a session
 *   POST /v1/internal/intervention/manual   — admin-triggered intervention
 */
export class InternalHandler {
  private readonly logger = createLogger({ service: 'InternalHandler' });

  constructor(
    private readonly orchestrator: DecisionOrchestrator,
    private readonly sessionFeatures: SessionFeaturesService,
    private readonly internalSecret: string,
  ) {}

  handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const authHeader = req.headers['x-internal-secret'];
    if (authHeader !== this.internalSecret) {
      res.writeHead(401).end('unauthorized');
      return;
    }

    const path = req.url?.split('?')[0] ?? '/';
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (path === '/v1/internal/recalculate') {
        void this.handleRecalculate(body, res);
      } else if (path === '/v1/internal/intervention/manual') {
        void this.handleManual(body, res);
      } else if (req.method === 'POST' && path.startsWith('/internal/execute/')) {
        const recommendationId = path.slice('/internal/execute/'.length);
        void this.handleExecute(recommendationId, res);
      } else {
        res.writeHead(404).end('not found');
      }
    });
    req.on('error', (err) => {
      this.logger.warn({ err }, 'InternalHandler: request read error');
      res.writeHead(500).end('internal error');
    });
  }

  /**
   * POST /v1/internal/recalculate
   * Body: { sessionId: string }
   *
   * Reads the current session state from Redis and re-runs the full decision pipeline
   * (Phase 1 + Phase 2). Equivalent to what the SchedulerWorker does on each tick.
   */
  private async handleRecalculate(body: string, res: http.ServerResponse): Promise<void> {
    let sessionId: string;
    try {
      const parsed = JSON.parse(body) as { sessionId?: unknown };
      if (typeof parsed.sessionId !== 'string' || !parsed.sessionId) {
        throw new Error('sessionId required');
      }
      sessionId = parsed.sessionId;
    } catch (err) {
      res
        .writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'invalid body', detail: String(err) }));
      return;
    }

    const ctx = await this.sessionFeatures.getSessionContext(sessionId);
    if (!ctx) {
      res
        .writeHead(404, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'session_not_found', sessionId }));
      return;
    }

    const event = this.sessionFeatures.toEnrichedEvent(ctx);
    await this.orchestrator.decide(event);

    res
      .writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ status: 'ok', sessionId }));
  }

  /**
   * POST /v1/internal/intervention/manual
   * Body: {
   *   sessionId: string,
   *   type: InterventionType,
   *   value: number,
   *   overrideCooldown?: boolean
   * }
   *
   * Bypasses risk threshold and directly executes Phase 2 with admin-provided params.
   * Respects budget. Respects cooldown unless overrideCooldown: true.
   * channel is inferred from session_available (in_shop if active, off_shop if stale).
   */
  private async handleManual(body: string, res: http.ServerResponse): Promise<void> {
    let sessionId: string;
    let type: string;
    let value: number;
    let overrideCooldown: boolean;

    try {
      const parsed = JSON.parse(body) as {
        sessionId?: unknown;
        type?: unknown;
        value?: unknown;
        overrideCooldown?: unknown;
      };
      if (typeof parsed.sessionId !== 'string' || !parsed.sessionId) throw new Error('sessionId required');
      if (typeof parsed.type !== 'string' || !parsed.type) throw new Error('type required');
      if (typeof parsed.value !== 'number') throw new Error('value must be a number');
      sessionId = parsed.sessionId;
      type = parsed.type;
      value = parsed.value;
      overrideCooldown = parsed.overrideCooldown === true;
    } catch (err) {
      res
        .writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'invalid body', detail: String(err) }));
      return;
    }

    const ctx = await this.sessionFeatures.getSessionContext(sessionId);
    if (!ctx) {
      res
        .writeHead(404, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'session_not_found', sessionId }));
      return;
    }

    if (ctx.customerId === null) {
      res
        .writeHead(422, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'customer_not_resolved', sessionId }));
      return;
    }

    // Infer channel from session availability
    const channel: InterventionChannel = ctx.sessionAvailable ? 'in_shop' : 'off_shop';

    const result = await this.orchestrator.manualDecide({
      sessionId,
      storeId: ctx.storeId,
      customerId: ctx.customerId,
      distinctId: ctx.distinctId,
      email: ctx.email,
      emailConsent: ctx.emailConsent,
      smsConsent: ctx.smsConsent,
      type: type as InterventionType,
      channel,
      value,
      overrideCooldown,
    });

    const statusCode = result.status === 'sent' ? 200 : result.status === 'skipped' ? 202 : 500;
    res
      .writeHead(statusCode, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(result));
  }

  private async handleExecute(recommendationId: string, res: http.ServerResponse): Promise<void> {
    if (!recommendationId || recommendationId.length < 10) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'invalid_recommendation_id' }));
      return;
    }
    try {
      const result = await this.orchestrator.executeRecommendation(recommendationId);
      const statusCode = result.status === 'executed' ? 200 : 202;
      res
        .writeHead(statusCode, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(result));
    } catch (err) {
      this.logger.error({ err, recommendationId }, 'handleExecute: unexpected error');
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'internal_error' }));
    }
  }
}
