import * as http from 'node:http';
import type { NotificationMetrics } from './metrics.js';

type NotifyHandler = (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;

export class HealthServer {
  private readonly server: http.Server;
  private started = false;

  constructor(
    private readonly metrics: NotificationMetrics,
    private readonly port: number,
    private readonly notifyHandler?: NotifyHandler,
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
      res.writeHead(200).end('ready');
      return;
    }

    if (path === '/metrics') {
      const body = await this.metrics.getMetrics();
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }).end(body);
      return;
    }

    if (path === '/v1/notify' && req.method === 'POST' && this.notifyHandler) {
      await this.notifyHandler(req, res);
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
