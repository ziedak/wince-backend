import { Hono } from 'hono';
import { createDb } from '@org/db';
import { RedisClient } from '@org/redis_client';
import { ClickHouseClient } from '@org/clickhouse_client';
import { createLogger } from '@org/logger';
import { loadConfig } from './config';
import { DecisionEngineClient } from './clients/decision-engine';
import { KongClient } from './clients/kong';
import { AuditService } from './services/audit';
import { rejectIdentity } from './middleware/reject-identity';
import { createHealthRouter } from './health';
import { createAuthRouter } from './routes/auth';
import { createStoresRouter } from './routes/stores';
import { createPoliciesRouter } from './routes/policies';
import { createExperimentsRouter } from './routes/experiments';
import { createAnalyticsRouter } from './routes/analytics';
import { createRiskRouter } from './routes/risk';
import { createInterventionRouter } from './routes/intervention';
import { createDiscountRouter } from './routes/discount';

const logger = createLogger({ service: 'admin-api' });

function parseRedisUrl(url: string) {
  const u = new URL(url);
  return { host: u.hostname, port: parseInt(u.port || '6379', 10), password: u.password || undefined };
}

const config = loadConfig();

// Infrastructure
const db = createDb({ connectionString: config.DATABASE_URL });
const redis = RedisClient.create(parseRedisUrl(config.REDIS_URL));
const ch = new ClickHouseClient({
  url: config.CLICKHOUSE_URL,
  username: new URL(config.CLICKHOUSE_URL).username || 'default',
  password: new URL(config.CLICKHOUSE_URL).password || '',
  database: new URL(config.CLICKHOUSE_URL).pathname.replace('/', '') || 'default',
  requestTimeout: 30_000,
  maxOpenConnections: 10,
  compression: { response: true, request: false },
});

// Clients
const de = new DecisionEngineClient(config);
const kong = new KongClient(config);

// Services
const audit = new AuditService(db);

// App
const app = new Hono();

// Global: strip client-supplied identity headers before any route sees them
app.use('*', rejectIdentity);

// Routes
app.route('/', createHealthRouter(db, redis, ch));
app.route('/', createAuthRouter(db, kong, audit, config));
app.route('/', createStoresRouter(db, kong, audit));
app.route('/', createPoliciesRouter(db, audit));
app.route('/', createExperimentsRouter(db, ch, audit));
app.route('/', createAnalyticsRouter(ch));
app.route('/', createRiskRouter(redis, de));
app.route('/', createInterventionRouter(de, audit));
app.route('/', createDiscountRouter(db, redis));

// 404 fallback
app.notFound((c) => c.json({ statusCode: 404, error: 'Not Found', message: 'Route not found' }, 404));

// Error handler
app.onError((err, c) => {
  logger.error({ err }, 'Unhandled error');
  return c.json({ statusCode: 500, error: 'Internal Server Error', message: 'An unexpected error occurred' }, 500);
});

logger.info({ port: config.PORT }, 'Starting admin-api');

export default {
  port: config.PORT,
  fetch: app.fetch,
};
