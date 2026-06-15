import * as http from 'node:http';
import type { RedisClient } from '@org/redis_client';
import { sql, type Db } from '@org/db';
import type { ConsumerState } from './consumer.js';
import type { EnrichmentMetrics } from './metrics.js';

export class HealthServer {
  private server: http.Server;

  constructor(
    private readonly state: ConsumerState,
    private readonly redis: RedisClient,
    private readonly db: Db,
    private readonly metrics: EnrichmentMetrics,
    private readonly port: number,
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
      const ready = await this.isReady();
      res.writeHead(ready ? 200 : 503).end(ready ? 'ready' : 'not ready');
      return;
    }

    if (path === '/metrics') {
      const body = await this.metrics.getMetrics();
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }).end(body);
      return;
    }

    res.writeHead(404).end('not found');
  }

  private async isReady(): Promise<boolean> {
    if (!this.state.subscribed || this.state.backingOff) return false;
    try {
      const [redisOk] = await Promise.all([
        this.redis.ping(),
        this.db.execute(sql`SELECT 1`),
      ]);
      return redisOk;
    } catch {
      return false;
    }
  }

  start(): void {
    this.server.listen(this.port, () => {
      console.log(`Health server listening on port ${this.port}`);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
