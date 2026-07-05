import { createLogger } from '@org/logger';
import { SessionFeaturesService, DecisionOrchestrator } from '../services';
import { SchedulerService } from '../services/scheduler.service';


/** Maximum time (ms) allowed for a single session's full decision pipeline per tick. */
const SESSION_PROCESS_TIMEOUT_MS = 5_000;

/**
 * Polls the `eval:queue` sorted set every second and re-runs the decision pipeline
 * for sessions that were previously below the risk threshold.
 *
 * Each popped session fetches fresh state from Redis so the re-evaluation reflects
 * any cart or frustration signal changes since the last scoring.
 */
export class SchedulerWorker {
  private readonly logger = createLogger({ service: 'SchedulerWorker' });
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly scheduler: SchedulerService,
    private readonly sessionFeatures: SessionFeaturesService,
    private readonly orchestrator: DecisionOrchestrator,
  ) {}

  start(): void {
    this.timer = setInterval(() => { void this.tick(); }, 1_000);
    this.logger.info('SchedulerWorker started (1s poll interval)');
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const sessionIds = await this.scheduler.popDue();
    if (sessionIds.length === 0) return;
    // Process all due sessions concurrently. A single stuck decide() no longer
    // blocks the entire tick — each session is independently time-bounded.
    const results = await Promise.allSettled(
      sessionIds.map((sid) => this.withTimeout(this.processSession(sid), sid)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        // withTimeout already logs; this is a safety net for unexpected rejections.
        this.logger.warn({ reason: result.reason }, 'SchedulerWorker: tick settlement rejected');
      }
    }
  }

  /**
   * Races `promise` against a hard timeout.
   * If the timeout fires first, the session is skipped and a warning is logged.
   */
  private withTimeout(promise: Promise<void>, sessionId: string): Promise<void> {
    return Promise.race([
      promise,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`session ${sessionId} timed out after ${SESSION_PROCESS_TIMEOUT_MS}ms`)),
          SESSION_PROCESS_TIMEOUT_MS,
        ),
      ),
    ]).catch((err: unknown) => {
      this.logger.warn({ err, sessionId }, 'SchedulerWorker: session processing timed out or failed');
    });
  }

  private async processSession(sessionId: string): Promise<void> {
    try {
      const ctx = await this.sessionFeatures.getSessionContext(sessionId);
      if (!ctx) {
        this.logger.debug({ sessionId }, 'SchedulerWorker: session hash expired, skipping');
        return;
      }
      const event = this.sessionFeatures.toEnrichedEvent(ctx);
      await this.orchestrator.decide(event);
    } catch (err) {
      this.logger.warn({ err, sessionId }, 'SchedulerWorker: error processing session (non-fatal)');
    }
  }
}
