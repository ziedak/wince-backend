import * as http from 'node:http';
import type { IMetrics } from '@org/types';

export type HealthCheck = { name: string; ok: boolean; error?: string };
export class SimpleServer {
  private server: http.Server;

  constructor(
    private readonly port: number,
    private readonly metrics: IMetrics,
  ) {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
  }

  private async handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const path = req.url?.split('?')[0] ?? '/';

      if (path === '/live') {
        res.writeHead(200).end('ok');
        return;
      }

      if (path === '/ready') {
        const checks = await this.isReady();
        const allOk = checks.every((c) => c.ok);
        const body = JSON.stringify({
          status: allOk ? 'ok' : 'degraded',
          checks,
        });
        res.writeHead(allOk ? 200 : 503, {
          'Content-Type': 'application/json',
        });
        res.end(body);
        return;
      }

      if (path === '/metrics') {
        const body = await this.metrics.getMetrics();
        res
          .writeHead(200, {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          })
          .end(body);
        return;
      }

      res.writeHead(404).end('not found');
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(
          'internal error' + (err instanceof Error ? `: ${err.message}` : ''),
        );
      }
    }
  }

  public isReady(): Promise<HealthCheck[]> {
    // In a real implementation, you would perform actual health checks here.
    // For this example, we'll just return a dummy check.
    return Promise.resolve([
      {
        name: 'dummy_check',
        ok: false,
        error: 'This is a dummy check that always fails',
      },
    ]);
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });

    this.server.listen(this.port, () => {
      console.log({ port: this.port }, 'Health server listening');
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
}
