import { createLogger } from '@org/logger';
import type { SchedulerService } from './scheduler.service.js';
import type { SessionFeaturesService } from '../session-features/session-features.service.js';
import type { DecisionOrchestrator } from '../intervention/intervention.service.js';

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
    for (const sessionId of sessionIds) {
      await this.processSession(sessionId);
    }
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
