import { createLogger } from '@org/logger';
import type { InShopPayload, NotificationRequest } from '@org/types';
import type { Config } from '../config.js';
import type { DecisionMetrics } from '../metrics.js';

/**
 * Routes completed intervention decisions to the appropriate downstream service.
 *
 * in_shop  → POST /v1/push  on intervention-gateway (100 ms hard timeout, bypasses Kong)
 * off_shop → POST /v1/notify on notification-service (no timeout; retried by notification svc)
 *
 * Channels are INDEPENDENT — never cascade.
 * Never throws: logs + continues on any delivery failure.
 */
export class OutboundService {
  private readonly logger = createLogger({ service: 'OutboundService' });

  constructor(
    private readonly config: Config,
    private readonly metrics: DecisionMetrics,
  ) {}

  async route(
    channel: 'in_shop' | 'off_shop',
    sessionId: string,
    payload: InShopPayload | NotificationRequest,
  ): Promise<void> {
    const start = Date.now();
    try {
      if (channel === 'in_shop') {
        await this.pushToGateway(sessionId, payload as InShopPayload);
      } else {
        await this.notifyOffShop(payload as NotificationRequest);
      }
    } catch (err) {
      this.logger.warn({ err, channel, sessionId }, 'OutboundService: delivery failed (non-fatal)');
    } finally {
      this.metrics.outboundDuration(channel, Date.now() - start);
    }
  }

  private async pushToGateway(sessionId: string, payload: InShopPayload): Promise<void> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 100); // 100 ms hard timeout
    try {
      const res = await fetch(`${this.config.gatewayUrl}/v1/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': this.config.internalSecret,
        },
        body: JSON.stringify({ sessionId, payload }),
        signal: ac.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          { status: res.status, sessionId },
          'OutboundService: gateway returned non-2xx (pending storage expected)',
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async notifyOffShop(payload: NotificationRequest): Promise<void> {
    const res = await fetch(`${this.config.notificationUrl}/v1/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': this.config.internalSecret,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      this.logger.warn(
        { status: res.status },
        'OutboundService: notification service returned non-2xx',
      );
    }
  }
}
