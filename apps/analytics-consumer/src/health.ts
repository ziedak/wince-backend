import * as http from 'node:http';
import type { ClickHouseClient } from '@org/clickhouse_client';
import type { RedisClient } from '@org/redis_client';
import { createLogger } from '@org/logger';
import type { Logger } from '@org/logger';
import type { ConsumerState } from './consumer.js';
import type { AnalyticsMetrics } from './metrics.js';

export class HealthServer {
  private readonly logger: Logger;
  private server: http.Server | null = null;

  constructor(
    private readonly state: ConsumerState,
    private readonly clickhouse: ClickHouseClient,
    private readonly metrics: AnalyticsMetrics,
    private readonly port: number,
    private readonly redis: RedisClient | null,
  ) {
    this.logger = createLogger({ service: 'HealthServer' });
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });

    this.server.listen(this.port, () => {
      this.logger.info({ port: this.port }, 'Health server listening');
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server === null) {
        resolve();
        return;
      }
      // Drop keep-alive connections so server.close() resolves promptly.
      this.server.closeAllConnections?.();
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      
      switch (req.url) {
        case '/live':
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('ok');
          break;

        case '/ready':
          await this.handleReady(res);
          break;

        case '/metrics':
          await this.handleMetrics(res);
          break;

        default:
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
      }
    } catch (err) {
      this.logger.error({ err }, 'Health handler error');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('internal error');
      }
    }
  }

  private async handleReady(res: http.ServerResponse): Promise<void> {
    const checks: Array<{ name: string; ok: boolean; error?: string }> = [];

    // Consumer subscribed and not in backoff
    checks.push({
      name: 'consumer_subscribed',
      ok: this.state.subscribed && !this.state.backingOff,
    });

    // ClickHouse reachability
    try {
      const healthy = await this.clickhouse.ping();
      checks.push({ name: 'clickhouse', ok: healthy });
    } catch (err) {
      checks.push({ name: 'clickhouse', ok: false, error: String(err) });
    }

    // Redis (only when dedup is enabled)
    if (this.redis !== null) {
      try {
        await this.redis.ping();
        checks.push({ name: 'redis', ok: true });
      } catch (err) {
        checks.push({ name: 'redis', ok: false, error: String(err) });
      }
    }

    const allOk = checks.every((c) => c.ok);
    const body = JSON.stringify({ status: allOk ? 'ok' : 'degraded', checks });
    res.writeHead(allOk ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(body);
  }

  private async handleMetrics(res: http.ServerResponse): Promise<void> {
    const body = await this.metrics.getMetrics();
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(body);
  }
}
