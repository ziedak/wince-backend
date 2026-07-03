import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';
import type { LockService } from '../lock/lock.service.js';
import type { SessionFeaturesService } from '../session-features/session-features.service.js';
import type { DecisionOrchestrator } from '../intervention/intervention.service.js';

const ACTIVE_SESSIONS_KEY = 'active:sessions';
const STALE_THRESHOLD_MS = 2 * 60 * 1_000;  // 2 minutes — sessions silent longer than this are stale
const SCAN_LOCK_KEY = 'scan:lock';
const SCAN_LOCK_TTL = 240;                   // 4 minutes — prevents permanent lock if process crashes
const SCAN_BATCH_LIMIT = 500;

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

  constructor(
    private readonly redis: RedisClient,
    private readonly sessionFeatures: SessionFeaturesService,
    private readonly orchestrator: DecisionOrchestrator,
    private readonly lock: LockService,
  ) {}

  start(): void {
    this.timer = setInterval(() => { void this.scan(); }, 5 * 60 * 1_000);
    this.logger.info('StaleScannerService started (5 min scan interval)');
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
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

      for (const sid of staleSids) {
        await this.processStaleSession(sid);
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

  private async processStaleSession(sessionId: string): Promise<void> {
    try {
      // Skip sessions that already received an intervention
      if (await this.lock.isSent(sessionId)) return;

      const ctx = await this.sessionFeatures.getSessionContext(sessionId);
      if (!ctx) return; // Session hash expired from Redis

      // Force session_available = false: stale session likely means closed tab
      const event = this.sessionFeatures.toEnrichedEvent(ctx);
      event.session_available = false;

      await this.orchestrator.decide(event);
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'StaleScannerService: error processing stale session (non-fatal)');
    }
  }
}
