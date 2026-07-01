import { createLogger } from '@org/logger';
import { RedisClient } from '@org/redis_client';
import { loadConfig } from './config.js';
import { GatewayMetrics } from './metrics.js';
import { PushHandler } from './push-handler.js';
import { PollHandler } from './poll-handler.js';
import { GatewayServer } from './server.js';
import type { WsUserData, AckRegistry } from './server.js';
import type uWS from 'uWebSockets.js';

const logger = createLogger({ service: 'intervention-gateway' });

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    password: parsed.password || undefined,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ port: config.port }, 'Starting intervention-gateway');

  const metrics = new GatewayMetrics();
  const redis = RedisClient.create(parseRedisUrl(config.redisUrl));

  // Create shared maps first — passed to both PushHandler and GatewayServer
  // so the server's WS lifecycle hooks and the push handler operate on the same state.
  const socketMap: Map<string, uWS.WebSocket<WsUserData>> = new Map();
  const ackRegistry: AckRegistry = new Map();

  const push = new PushHandler(config, redis, metrics, socketMap, ackRegistry);
  const poll = new PollHandler(redis, metrics);

  const server = new GatewayServer(config, redis, metrics, push, poll, socketMap, ackRegistry);

  await server.start();

  const shutdown = (): void => {
    logger.info('Shutting down intervention-gateway');
    server.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
