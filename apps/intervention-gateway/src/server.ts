import uWS from 'uWebSockets.js';
import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';
import type { GatewayMetrics } from './metrics.js';
import type { Config } from './config.js';
import type { PushHandler } from './push-handler.js';
import type { PollHandler } from './poll-handler.js';

/** Per-socket user data stored in the uWS socket object. */
export interface WsUserData {
  sessionId: string;
}

/** ACK resolver keyed by interventionId. Set when push handler awaits WS ack. */
export type AckRegistry = Map<string, (success: boolean) => void>;

const logger = createLogger({ service: 'GatewayServer' });

/**
 * uWebSockets.js gateway server.
 *
 * Routes:
 *   GET  /ws                        — WebSocket upgrade (tracker.js)
 *   POST /v1/push                   — Internal push endpoint (Decision Engine)
 *   GET  /v1/interventions/pending  — REST poll fallback (tracker.js)
 *   GET  /live, /ready, /metrics    — Health probes
 *
 * WebSocket lifecycle:
 *   open    → register socket + SET ws:active:{sessionId} = podIp EX ttl
 *   message → renew TTL + handle ack; server-side ping every 30s prevents idle expiry
 *   close   → deregister socket + DEL ws:active:{sessionId}
 */
export class GatewayServer {
  private readonly app: uWS.TemplatedApp;
  /** Live sockets on THIS pod only. */
  readonly socketMap: Map<string, uWS.WebSocket<WsUserData>>;
  /** Pending WS-ack callbacks, keyed by interventionId. */
  readonly ackRegistry: AckRegistry;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private listenSocket: uWS.us_listen_socket | null = null;

  constructor(
    private readonly config: Config,
    private readonly redis: RedisClient,
    private readonly metrics: GatewayMetrics,
    private readonly push: PushHandler,
    private readonly poll: PollHandler,
    /** Externally supplied — allows main.ts to share these with PushHandler. */
    socketMap: Map<string, uWS.WebSocket<WsUserData>>,
    ackRegistry: AckRegistry,
  ) {
    this.socketMap = socketMap;
    this.ackRegistry = ackRegistry;
    this.app = uWS.App();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.app

      // ── WebSocket ─────────────────────────────────────────────────────────
      .ws<WsUserData>('/ws', {
        /** idleTimeout=0 — server heartbeat renews TTL instead */
        idleTimeout: 0,
        /** Send pings automatically to keep NAT alive (different from our heartbeat) */
        sendPingsAutomatically: false,

        upgrade: (res, req, context) => {
          const sessionId = req.getQuery('session_id');
          if (!sessionId) {
            res.writeStatus('400 Bad Request').end('session_id required');
            return;
          }
          res.upgrade<WsUserData>(
            { sessionId },
            req.getHeader('sec-websocket-key'),
            req.getHeader('sec-websocket-protocol'),
            req.getHeader('sec-websocket-extensions'),
            context,
          );
        },

        open: (ws) => {
          const { sessionId } = ws.getUserData();
          this.socketMap.set(sessionId, ws);
          const redis = this.redis.getRedis();
          void redis.setex(
            `ws:active:${sessionId}`,
            this.config.wsTtlSeconds,
            this.config.podIp,
          );
          this.metrics.wsActivity('connect', this.socketMap.size);
          logger.info({ sessionId, connections: this.socketMap.size }, 'WS connected');
        },

        message: (ws, message) => {
          const { sessionId } = ws.getUserData();
          // Renew Redis TTL on any inbound message (heartbeat or ack)
          const redis = this.redis.getRedis();
          void redis.setex(
            `ws:active:${sessionId}`,
            this.config.wsTtlSeconds,
            this.config.podIp,
          );
          this.metrics.wsActivity('heartbeat', this.socketMap.size);

          // Handle ack from tracker.js: { type: 'ack', interventionId: '...' }
          try {
            const text = Buffer.from(message).toString();
            const msg = JSON.parse(text) as { type?: string; interventionId?: string };
            if (msg.type === 'ack' && msg.interventionId) {
              const resolve = this.ackRegistry.get(msg.interventionId);
              if (resolve) resolve(true);
            }
          } catch {
            // ignore non-JSON messages (tracker.js pings, etc.)
          }
        },

        close: (ws) => {
          const { sessionId } = ws.getUserData();
          this.socketMap.delete(sessionId);
          void this.redis.safeDel(`ws:active:${sessionId}`);
          // If there was a pending ack waiting, resolve as false
          // (iterate ack registry — find any ack for this session if needed)
          this.metrics.wsActivity('disconnect', this.socketMap.size);
          logger.info({ sessionId, connections: this.socketMap.size }, 'WS disconnected');
        },
      })

      // ── Internal push ─────────────────────────────────────────────────────
      .post('/v1/push', (res, req) => {
        const secret = req.getHeader('x-internal-secret');
        if (secret !== this.config.internalSecret) {
          res.writeStatus('401 Unauthorized').end('unauthorized');
          return;
        }
        this.push.handle(res);
      })

      // ── REST poll fallback ────────────────────────────────────────────────
      .get('/v1/interventions/pending', (res, req) => {
        const sessionId = req.getQuery('session_id');
        if (!sessionId) {
          res.writeStatus('400 Bad Request').end('session_id required');
          return;
        }
        this.poll.handle(res, sessionId);
      })

      // ── Health ────────────────────────────────────────────────────────────
      .get('/live', (res) => {
        res.writeStatus('200 OK').end('ok');
      })
      .get('/ready', (res) => {
        res.writeStatus('200 OK').end('ready');
      })
      .get('/metrics', (res) => {
        res.onAborted(() => undefined);
        void this.metrics.getMetrics().then((body) => {
          res.cork(() => {
            res
              .writeStatus('200 OK')
              .writeHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
              .end(body);
          });
        });
      });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.app.listen(this.config.port, (socket) => {
        if (!socket) {
          reject(new Error(`Failed to listen on port ${this.config.port}`));
          return;
        }
        this.listenSocket = socket;
        logger.info({ port: this.config.port }, 'Gateway listening');

        // Server-side heartbeat: ping all sockets every 30s.
        // Renews Redis TTL so idle sessions don't expire while connected.
        this.heartbeatTimer = setInterval(() => {
          for (const [sessionId, ws] of this.socketMap) {
            try {
              ws.ping();
              const redis = this.redis.getRedis();
              void redis.setex(
                `ws:active:${sessionId}`,
                this.config.wsTtlSeconds,
                this.config.podIp,
              );
            } catch {
              // socket may have closed between iteration and ping
            }
          }
        }, 30_000);

        resolve();
      });
    });
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.listenSocket) {
      uWS.us_listen_socket_close(this.listenSocket);
      this.listenSocket = null;
    }
  }
}
