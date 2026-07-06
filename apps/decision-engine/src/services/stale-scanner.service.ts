import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';
import { interventionRecommendations, eq, and, type Db } from '@org/db';
import { FeatureService } from './features.service';
import { DecisionOrchestrator } from './intervention.service';
import { LockService } from './lock.service';
import { SessionContext, SessionFeaturesService } from './session-features.service';


const ACTIVE_SESSIONS_KEY = 'active:sessions';
const STALE_THRESHOLD_MS = 2 * 60 * 1_000;  // 2 minutes — sessions silent longer than this are stale
const SCAN_LOCK_KEY = 'scan:lock';
const SCAN_LOCK_TTL = 240;                   // 4 minutes — prevents permanent lock if process crashes
const SCAN_BATCH_LIMIT = 500;
const EXPIRY_LOCK_KEY = 'expiry:scan:lock';
const EXPIRY_SCAN_INTERVAL_MS = 60_000;      // 1 minute
const EXPIRY_BATCH_LIMIT = 200;

/**
 * Detects silent session abandonment (e.g. closed browser tabs) by scanning
 * the `active:sessions` sorted set for sessions with no recent activity.
 *
 * Runs every 5 minutes using a distributed lock to prevent duplicate scans
 * across horizontally scaled instances. Stale sessions are re-evaluated by
 * the decision orchestrator with `session_available = false`, allowing the
 * rules engine to route to off-shop channels (email / SMS).
 */
export class StaleScannerService {
  private readonly logger = createLogger({ service: 'StaleScannerService' });
  private timer: NodeJS.Timeout | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisClient,
    private readonly sessionFeatures: SessionFeaturesService,
    private readonly orchestrator: DecisionOrchestrator,
    private readonly lock: LockService,
    private readonly features: FeatureService,
    private readonly db: Db,
  ) {}

  start(): void {
    this.timer = setInterval(() => { void this.scan(); }, 5 * 60 * 1_000);
    this.expiryTimer = setInterval(() => { void this.expireRecommendations(); }, EXPIRY_SCAN_INTERVAL_MS);
    this.logger.info('StaleScannerService started (5 min stale scan, 1 min expiry scan)');
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.expiryTimer !== null) { clearInterval(this.expiryTimer); this.expiryTimer = null; }
  }

  async scan(): Promise<void> {
    const raw = this.redis.getRedis();

    // Distributed lock prevents duplicate scans when multiple instances are running
    let lockAcquired = false;
    try {
      const result = await raw.set(SCAN_LOCK_KEY, '1', 'EX', SCAN_LOCK_TTL, 'NX');
      lockAcquired = result === 'OK';
    } catch (err) {
      this.logger.warn({ err }, 'StaleScannerService: failed to acquire scan lock, skipping cycle');
      return;
    }
    if (!lockAcquired) {
      this.logger.debug('StaleScannerService: another instance is scanning, skipping');
      return;
    }

    try {
      const staleThreshold = Date.now() - STALE_THRESHOLD_MS;
      const staleSids = await raw.zrangebyscore(
        ACTIVE_SESSIONS_KEY,
        0,
        staleThreshold,
        'LIMIT',
        0,
        SCAN_BATCH_LIMIT,
      );
      this.logger.info({ count: staleSids.length }, 'StaleScannerService: processing stale sessions');

      // Batch pre-fetch all session contexts first (to build feature prefetch list)
      const contexts = await Promise.all(
        staleSids.map((sid) => this.sessionFeatures.getSessionContext(sid)),
      );

      // Batch pre-fetch ClickHouse features in a single query per store
      const featureEntries = contexts
        .filter((ctx) => ctx !== null)
        .map((ctx) => ({ storeId: ctx!.storeId, distinctId: ctx!.distinctId }));
      await this.features.prefetchBatch(featureEntries);

      for (let i = 0; i < staleSids.length; i++) {
        await this.processStaleSession(staleSids[i]!, contexts[i]);
      }
    } catch (err) {
      this.logger.error({ err }, 'StaleScannerService: scan error');
    } finally {
      try {
        await raw.del(SCAN_LOCK_KEY);
      } catch {
        // Lock will expire naturally via TTL
      }
    }
  }

  private async processStaleSession(
    sessionId: string,
    ctx: SessionContext | null | undefined,
  ): Promise<void> {
    try {
      if (!ctx) return; // Session hash expired from Redis

      // Skip sessions whose user already received an intervention
      if (ctx.customerId !== null && await this.lock.isSent(ctx.customerId)) return;

      // Force session_available = false: stale session likely means closed tab
      const event = this.sessionFeatures.toEnrichedEvent(ctx);
      event.session_available = false;

      await this.orchestrator.decide(event);
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'StaleScannerService: error processing stale session (non-fatal)');
    }
  }

  /**
   * Scans all `pending:store:*` Redis sorted sets for recommendations whose
   * expiresAt score ≤ now, marks them expired in PostgreSQL, and removes them
   * from the sorted set.
   *
   * Uses a distributed lock (EXPIRY_LOCK_KEY) to prevent duplicate processing
   * across horizontally scaled instances. Runs every 60 seconds.
   */
  async expireRecommendations(): Promise<void> {
    const raw = this.redis.getRedis();

    const result = await raw.set(EXPIRY_LOCK_KEY, '1', 'EX', 90, 'NX').catch(() => null);
    if (result !== 'OK') return; // Another instance is running expiry

    try {
      const nowMs = Date.now();
      // Scan all pending:store:* keys
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, found] = await raw.scan(cursor, 'MATCH', 'pending:store:*', 'COUNT', 100);
        cursor = nextCursor;
        keys.push(...found);
      } while (cursor !== '0');

      let totalExpired = 0;

      for (const key of keys) {
        // ZRANGEBYSCORE returns members whose score (expiresAt ms) ≤ now
        const expired = await raw.zrangebyscore(key, 0, nowMs, 'LIMIT', 0, EXPIRY_BATCH_LIMIT);
        if (expired.length === 0) continue;

        for (const recId of expired) {
          try {
            await this.db
              .update(interventionRecommendations)
              .set({ status: 'expired', updatedAt: new Date() })
              .where(
                and(
                  eq(interventionRecommendations.id, recId),
                  eq(interventionRecommendations.status, 'pending'),
                ),
              );
            await raw.zrem(key, recId);
            totalExpired++;
          } catch (err) {
            this.logger.warn({ err, recId, key }, 'StaleScannerService: failed to expire recommendation');
          }
        }
      }

      if (totalExpired > 0) {
        this.logger.info({ totalExpired }, 'StaleScannerService: expired recommendations marked');
      }
    } catch (err) {
      this.logger.error({ err }, 'StaleScannerService: expiry scan error');
    } finally {
      await raw.del(EXPIRY_LOCK_KEY).catch(() => {});
    }
  }
}
