import { createLogger } from '@org/logger';
import { interventions, eq, type Db } from '@org/db';
import type { ProducerClient } from '@org/kafka_client';
import type { InterventionRecord } from '@org/types';
import type { DecisionMetrics } from '../metrics.js';

/**
 * Persists an intervention record and publishes it to the intervention.log topic.
 *
 * Order matters — INSERT with delivered=false FIRST to prevent ghost interventions:
 *   1. INSERT interventions (delivered=false)
 *   2. Produce to intervention.log (DLQ on failure)
 *
 * After the outbound service confirms delivery, call markDelivered().
 * Never throws — logs failures and continues.
 */
export class InterventionWriter {
  private readonly logger = createLogger({ service: 'InterventionWriter' });

  constructor(
    private readonly db: Db,
    private readonly producer: ProducerClient,
    private readonly interventionLogTopic: string,
    private readonly dlqTopic: string,
    private readonly metrics: DecisionMetrics,
  ) {}

  async write(record: InterventionRecord): Promise<void> {
    const start = Date.now();

    // Step 1: INSERT with delivered=false — must happen before outbound attempt
    try {
      await this.db.insert(interventions).values({
        interventionId: record.interventionId,
        sessionId: record.sessionId,
        storeId: record.storeId,
        distinctId: record.distinctId,
        type: record.type,
        channel: record.channel,
        value: record.value !== undefined ? String(record.value) : null,
        discountCode: record.discountCode ?? null,
        triggerReason: record.triggerReason ?? null,
        delivered: false,
        experimentId: record.experimentId ?? null,
        variant: record.variant ?? null,
        decisionLatencyMs: record.decisionLatencyMs,
        confidenceScore:
          record.confidenceScore !== undefined
            ? String(record.confidenceScore)
            : null,
      });
    } catch (err) {
      this.logger.error(
        { err, interventionId: record.interventionId },
        'InterventionWriter: DB insert failed (non-fatal)',
      );
    }

    this.metrics.dbOperation('postgres', 'intervention_insert', Date.now() - start);

    // Step 2: Produce to intervention.log — DLQ on failure
    try {
      await this.producer.send(this.interventionLogTopic, record.sessionId, record);
    } catch (err) {
      this.logger.error(
        { err, interventionId: record.interventionId },
        'InterventionWriter: Kafka produce failed — sending to DLQ',
      );
      await this.sendToDlq(record);
    }
  }

  /**
   * Sets delivered=true and records which channel delivered the intervention.
   * Called by the orchestrator after outbound.route() returns.
   */
  async markDelivered(interventionId: string, deliveredVia: string): Promise<void> {
    try {
      await this.db
        .update(interventions)
        .set({ delivered: true, deliveredVia })
        .where(eq(interventions.interventionId, interventionId));
    } catch (err) {
      this.logger.warn(
        { err, interventionId },
        'InterventionWriter: markDelivered failed (non-fatal)',
      );
    }
  }

  private async sendToDlq(record: InterventionRecord): Promise<void> {
    try {
      await this.producer.send(this.dlqTopic, record.sessionId, {
        reason: 'intervention_log_produce_failed',
        original: JSON.stringify(record),
        service: 'decision-engine',
        timestamp: new Date().toISOString(),
      });
    } catch (dlqErr) {
      this.logger.error({ dlqErr }, 'InterventionWriter: DLQ produce also failed');
    }
  }
}
