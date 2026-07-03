import * as http from 'node:http';
import type { DecisionMetrics } from './metrics.js';
import type { TriggerHandler } from './trigger/trigger.handler.js';
import type { RedisClient } from '@org/redis_client';
import type { ConsumerState } from './kafka/decision.consumer.js';

export class HealthServer {
  private readonly server: http.Server;
  private started = false;

  constructor(
    private readonly metrics: DecisionMetrics,
    private readonly port: number,
    private readonly triggerHandler?: TriggerHandler,
    private readonly redis?: RedisClient,
    private readonly consumerState?: ConsumerState,
    private readonly internalHandler?: import('./internal/internal-handler.js').InternalHandler,
  ) {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = req.url?.split('?')[0] ?? '/';

    if (path === '/live') {
      res.writeHead(200).end('ok');
      return;
    }

    if (path === '/ready') {
      if (this.redis && this.consumerState) {
        try {
          await this.redis.getRedis().ping();
        } catch {
          res
            .writeHead(503, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ status: 'not_ready', reason: 'redis_unavailable' }));
          return;
        }
        if (!this.consumerState.subscribed) {
          res
            .writeHead(503, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ status: 'not_ready', reason: 'kafka_not_subscribed' }));
          return;
        }
      }
      res.writeHead(200).end('ready');
      return;
    }

    if (path === '/metrics') {
      const body = await this.metrics.getMetrics();
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }).end(body);
      return;
    }

    if (req.method === 'POST' && path === '/v1/trigger') {
      if (this.triggerHandler) {
        this.triggerHandler.handle(req, res);
      } else {
        res.writeHead(501).end('trigger handler not configured');
      }
      return;
    }

    if (req.method === 'POST' && (path === '/v1/internal/recalculate' || path === '/v1/internal/intervention/manual')) {
      if (this.internalHandler) {
        this.internalHandler.handle(req, res);
      } else {
        res.writeHead(501).end('internal handler not configured');
      }
      return;
    }

    res.writeHead(404).end('not found');
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.server.listen(this.port);
  }

  stop(): void {
    this.server.close();
  }
}
