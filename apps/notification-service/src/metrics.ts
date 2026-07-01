import { MetricsCollector } from '@org/monitoring';

export class NotificationMetrics {
  private readonly mc: MetricsCollector;

  constructor() {
    this.mc = MetricsCollector.create();
  }

  notificationSent(channel: 'email' | 'sms', result: 'success' | 'skipped' | 'failed'): void {
    void this.mc.recordCounter('notification_sent_total', 1, { channel, result });
  }

  retryAttempt(channel: 'email' | 'sms', attempt: number): void {
    void this.mc.recordCounter('notification_retry_total', 1, {
      channel,
      attempt: String(attempt),
    });
  }

  dlqProduced(): void {
    void this.mc.recordCounter('notification_dlq_total');
  }

  async getMetrics(): Promise<string> {
    return this.mc.getMetrics();
  }
}
