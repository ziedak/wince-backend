import { createLogger } from '@org/logger';
import { createProducerClient } from '@org/kafka_client';
import type * as http from 'node:http';
import type { NotificationRequest } from '@org/types';
import { loadConfig } from './config.js';
import { NotificationMetrics } from './metrics.js';
import { HealthServer } from './health.js';
import { NotificationService } from './notification/notification.service.js';
import { RetryInterceptor } from './notification/retry.interceptor.js';

const logger = createLogger({ service: 'notification-service' });

/** Reads the full request body from a Node.js IncomingMessage. */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ port: config.port }, 'Starting notification-service');

  const metrics = new NotificationMetrics();

  const producer = createProducerClient({
    brokers: config.kafkaBrokers,
    clientId: 'notification-service',
  });

  const notificationSvc = new NotificationService(config, metrics);
  const interceptor = new RetryInterceptor(
    notificationSvc,
    producer,
    config.kafkaTopicNotificationLog,
    config.kafkaTopicDlq,
    metrics,
  );

  const notifyHandler = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    // Validate internal secret
    const secret = req.headers['x-internal-secret'];
    if (secret !== config.internalSecret) {
      res.writeHead(401).end('unauthorized');
      return;
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }

    let payload: NotificationRequest;
    try {
      payload = JSON.parse(body) as NotificationRequest;
      if (!payload.interventionId || !payload.type) throw new Error('missing required fields');
    } catch {
      res.writeHead(400).end('invalid body');
      return;
    }

    // Respond 202 immediately — delivery is async with retry
    res.writeHead(202, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ status: 'accepted', interventionId: payload.interventionId }),
    );

    // Fire-and-forget with retry + DLQ
    void interceptor.dispatch(payload);
  };

  const healthServer = new HealthServer(metrics, config.port, notifyHandler);
  healthServer.start();
  logger.info({ port: config.port }, 'Notification service listening');

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down notification-service');
    await producer.shutdown();
    healthServer.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
