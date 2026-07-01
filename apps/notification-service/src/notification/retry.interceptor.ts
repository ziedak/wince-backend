import { createLogger } from '@org/logger';
import type { ProducerClient } from '@org/kafka_client';
import type { NotificationRequest } from '@org/types';
import type { NotificationService, NotificationResult } from './notification.service.js';
import type { NotificationMetrics } from '../metrics.js';

const logger = createLogger({ service: 'RetryInterceptor' });

const RETRY_DELAYS = [1_000, 2_000, 4_000]; // 3 attempts: 1s, 2s, 4s backoff

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface NotificationLog {
  interventionId: string;
  sessionId: string;
  storeId: number;
  channel: 'email' | 'sms';
  outcome: 'delivered' | 'skipped' | 'failed';
  attempts: number;
  reason?: string;
  timestamp: string;
}

/**
 * Wraps NotificationService.send() with 3-attempt exponential backoff.
 *
 * Produces notification.log REGARDLESS of outcome (success, skip, or failure).
 * On final failure sends to dead.letters.
 *
 * Skipped outcomes (consent/config missing) are NOT retried — they are
 * immediate and logged once.
 */
export class RetryInterceptor {
  constructor(
    private readonly notificationSvc: NotificationService,
    private readonly producer: ProducerClient,
    private readonly logTopic: string,
    private readonly dlqTopic: string,
    private readonly metrics: NotificationMetrics,
  ) {}

  async dispatch(req: NotificationRequest): Promise<void> {
    let result: NotificationResult | null = null;
    let attempts = 0;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      attempts = attempt + 1;
      try {
        result = await this.notificationSvc.send(req);
        lastErr = null;

        // Skipped outcomes are non-retriable
        if (result.outcome === 'skipped') break;

        // Delivered — done
        break;
      } catch (err) {
        lastErr = err;
        this.metrics.retryAttempt(req.type, attempt + 1);
        logger.warn(
          { err, attempt: attempt + 1, interventionId: req.interventionId },
          'Notification attempt failed',
        );
        if (attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]!);
        }
      }
    }

    const outcome: NotificationLog['outcome'] = result
      ? result.outcome === 'delivered'
        ? 'delivered'
        : 'skipped'
      : 'failed';

    const log: NotificationLog = {
      interventionId: req.interventionId,
      sessionId: req.sessionId,
      storeId: req.storeId,
      channel: req.type,
      outcome,
      attempts,
      reason: result?.reason ?? (lastErr instanceof Error ? lastErr.message : String(lastErr ?? '')),
      timestamp: new Date().toISOString(),
    };

    // Always produce notification.log — even on failure
    await this.produceLog(log, req.sessionId);

    // Final failure → DLQ
    if (outcome === 'failed') {
      this.metrics.dlqProduced();
      await this.sendToDlq(req);
      logger.error(
        { interventionId: req.interventionId, attempts },
        'Notification failed after all retries — sent to DLQ',
      );
    } else {
      logger.info({ interventionId: req.interventionId, outcome, attempts }, 'Notification outcome');
    }
  }

  private async produceLog(log: NotificationLog, key: string): Promise<void> {
    try {
      await this.producer.send(this.logTopic, key, log);
    } catch (err) {
      logger.error({ err, interventionId: log.interventionId }, 'Failed to produce notification.log');
    }
  }

  private async sendToDlq(req: NotificationRequest): Promise<void> {
    try {
      await this.producer.send(this.dlqTopic, req.sessionId, {
        reason: 'notification_failed',
        original: JSON.stringify(req),
        service: 'notification-service',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err }, 'Failed to produce to DLQ');
    }
  }
}
