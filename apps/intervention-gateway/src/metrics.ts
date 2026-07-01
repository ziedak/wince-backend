import { MetricsCollector } from '@org/monitoring';

export class GatewayMetrics {
  private readonly mc: MetricsCollector;

  constructor() {
    this.mc = MetricsCollector.create();
  }

  wsActivity(event: 'connect' | 'disconnect' | 'heartbeat', activeConnections: number): void {
    void this.mc.recordCounter('gateway_ws_events_total', 1, { event });
    void this.mc.recordGauge('gateway_ws_active_connections', activeConnections);
  }

  apiRequest(method: string, path: string, statusCode: number, durationMs: number): void {
    void this.mc.recordHistogram('gateway_api_request_ms', durationMs, {
      method,
      path,
      status: String(statusCode),
    });
  }

  pendingStored(): void {
    void this.mc.recordCounter('gateway_pending_stored_total');
  }

  pendingDelivered(via: 'ws' | 'poll'): void {
    void this.mc.recordCounter('gateway_pending_delivered_total', 1, { via });
  }

  async getMetrics(): Promise<string> {
    return this.mc.getMetrics();
  }
}
