import { createLogger } from '@org/logger';
import type uWS from 'uWebSockets.js';
import type { InShopPayload } from '@org/types';
import type { RedisClient } from '@org/redis_client';
import type { GatewayMetrics } from './metrics.js';
import type { Config } from './config.js';
import type { WsUserData, AckRegistry } from './server.js';

const logger = createLogger({ service: 'PushHandler' });

/**
 * Reads the full request body from a uWS HttpResponse.
 * Must be called synchronously from the route handler (before any await).
 */
function readBody(res: uWS.HttpResponse): Promise<string> {
  return new Promise((resolve) => {
    let chunks = Buffer.alloc(0);
    let aborted = false;
    res.onAborted(() => {
      aborted = true;
      resolve('');
    });
    res.onData((chunk, isLast) => {
      if (aborted) return;
      chunks = Buffer.concat([chunks, Buffer.from(chunk)]);
      if (isLast) resolve(chunks.toString());
    });
  });
}

/**
 * Handles POST /v1/push (internal — bypasses Kong, authenticated by X-Internal-Secret).
 *
 * Decision flow per push request:
 *   1. Parse { sessionId, payload }
 *   2. Check local socket map for sessionId
 *   3a. Found locally → send via WS → await ack up to 2s → 200 delivered
 *   3b. Not local → check Redis ws:active:{sessionId} for remote pod IP
 *        - Remote pod found → forward HTTP POST to that pod → mirror its response
 *        - No pod anywhere → SETEX intervention:pending:{sessionId} → 202 pending
 */
export class PushHandler {
  constructor(
    private readonly config: Config,
    private readonly redis: RedisClient,
    private readonly metrics: GatewayMetrics,
    private readonly socketMap: Map<string, uWS.WebSocket<WsUserData>>,
    private readonly ackRegistry: AckRegistry,
  ) {}

  handle(res: uWS.HttpResponse): void {
    // Must call readBody synchronously (starts listening for onData chunks)
    const bodyPromise = readBody(res);

    void bodyPromise.then(async (rawBody) => {
      // Guard all response writes: DE's 100 ms AbortController may disconnect before we respond.
      // In uWS, writing to an aborted response is undefined behavior in native code.
      let aborted = false;
      res.onAborted(() => { aborted = true; });

      if (!rawBody || aborted) return;

      let sessionId: string;
      let payload: InShopPayload;
      try {
        const body = JSON.parse(rawBody) as { sessionId?: unknown; payload?: unknown };
        if (typeof body.sessionId !== 'string' || !body.payload) {
          throw new Error('Invalid body shape');
        }
        sessionId = body.sessionId;
        payload = body.payload as InShopPayload;
      } catch {
        if (aborted) return;
        res.cork(() => res.writeStatus('400 Bad Request').end('invalid body'));
        return;
      }

      const t0 = Date.now();

      // ── 1. Try local socket ───────────────────────────────────────────────
      const localSocket = this.socketMap.get(sessionId);
      if (localSocket) {
        const delivered = await this.sendWithAck(localSocket, payload);
        if (delivered) {
          this.metrics.pendingDelivered('ws');
          if (aborted) return;
          res.cork(() =>
            res
              .writeStatus('200 OK')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify({ status: 'delivered', via: 'ws' })),
          );
          logger.debug({ sessionId, latencyMs: Date.now() - t0 }, 'Push delivered via WS');
          return;
        }
        // WS send failed (backpressure/ack timeout) — fall through to pending
      }

      // ── 2. Try remote pod via Redis ───────────────────────────────────────
      const remotePodIp = await this.redis.safeGet(`ws:active:${sessionId}`);
      if (remotePodIp && remotePodIp !== this.config.podIp) {
        const forwarded = await this.forwardToPod(remotePodIp, sessionId, payload);
        if (forwarded) {
          if (aborted) return;
          res.cork(() =>
            res
              .writeStatus('200 OK')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify({ status: 'delivered', via: 'forwarded' })),
          );
          return;
        }
      }

      // ── 3. Store as pending ───────────────────────────────────────────────
      await this.storePending(sessionId, payload);
      this.metrics.pendingStored();
      if (aborted) return;
      res.cork(() =>
        res
          .writeStatus('202 Accepted')
          .writeHeader('Content-Type', 'application/json')
          .end(JSON.stringify({ status: 'pending' })),
      );
      logger.debug({ sessionId }, 'Push stored as pending');
    });
  }

  private sendWithAck(
    ws: uWS.WebSocket<WsUserData>,
    payload: InShopPayload,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const sendResult = ws.send(JSON.stringify(payload));
      // sendResult: 1 = success, 2 = dropped (backpressure limit), 0 = buffered
      if (sendResult === 2) {
        // Dropped — do not wait for ack
        resolve(false);
        return;
      }

      // Await ack from tracker.js (max 2s)
      const timer = setTimeout(() => {
        this.ackRegistry.delete(payload.interventionId);
        // Timeout — consider it buffered/not acked, fall back to pending
        resolve(false);
      }, 2_000);

      this.ackRegistry.set(payload.interventionId, (success) => {
        clearTimeout(timer);
        this.ackRegistry.delete(payload.interventionId);
        resolve(success);
      });
    });
  }

  private async forwardToPod(
    podIp: string,
    sessionId: string,
    payload: InShopPayload,
  ): Promise<boolean> {
    try {
      const res = await fetch(`http://${podIp}:${this.config.port}/v1/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.config.internalSecret,
        },
        body: JSON.stringify({ sessionId, payload }),
        signal: AbortSignal.timeout(500),
      });
      return res.ok;
    } catch (err) {
      logger.warn({ err, podIp, sessionId }, 'PushHandler: pod forward failed');
      return false;
    }
  }

  private async storePending(sessionId: string, payload: InShopPayload): Promise<void> {
    await this.redis.safeSetEx(
      `intervention:pending:${sessionId}`,
      this.config.pendingTtlSeconds,
      JSON.stringify(payload),
    );
  }
}
