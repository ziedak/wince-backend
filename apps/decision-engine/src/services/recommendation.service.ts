import { createLogger } from '@org/logger';
import { interventionRecommendations, eq, type Db } from '@org/db';
import type {
  InterventionRecommendation,
  NewInterventionRecommendation,
} from '@org/db';
import type { ProducerClient } from '@org/kafka_client';
import type { RedisClient } from '@org/redis_client';
import type { InterventionType, InterventionChannel } from '@org/types';
import type { DecisionMetrics } from '../metrics.js';

export interface GenerateParams {
  storeId: number;
  sessionId: string;
  distinctId: string;
  customerId: number;
  riskScore: number;
  predictionProbability: number | null;
  predictionConfidence: number | null;
  type: InterventionType;
  channel: InterventionChannel;
  value: number;
  triggerReason?: string;
  featureSchemaVersion?: string;
  approvalTimeoutSeconds: number;
}

export { InterventionRecommendation };

/**
 * Manages the lifecycle of intervention recommendations.
 *
 * Responsibilities:
 *   - Persist new recommendations to PostgreSQL
 *   - Maintain pending:store:{storeId} Redis sorted set (score = expiresAt ms)
 *     for O(log N) admin pagination and expiry scanning
 *   - Produce audit events to the intervention.recommendations Kafka topic
 *   - Provide status-transition helpers used by the orchestrator and expiry worker
 */
export class RecommendationService {
  private readonly logger = createLogger({ service: 'RecommendationService' });

  constructor(
    private readonly db: Db,
    private readonly redis: RedisClient,
    private readonly producer: ProducerClient,
    private readonly kafkaTopic: string,
    readonly metrics: DecisionMetrics,
  ) {}

  /**
   * Generates a new recommendation record.
   * Returns the recommendation UUID; the caller uses it to route auto-execution
   * or leave the record pending for admin approval.
   */
  async generate(params: GenerateParams): Promise<string> {
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + params.approvalTimeoutSeconds * 1_000);

    const row: NewInterventionRecommendation = {
      id,
      storeId: params.storeId,
      sessionId: params.sessionId,
      distinctId: params.distinctId,
      customerId: params.customerId,
      riskScore: String(params.riskScore),
      predictionProbability:
        params.predictionProbability !== null ? String(params.predictionProbability) : null,
      predictionConfidence:
        params.predictionConfidence !== null ? String(params.predictionConfidence) : null,
      type: params.type,
      channel: params.channel,
      value: String(params.value),
      status: 'pending',
      expiresAt,
      triggerReason: params.triggerReason ?? null,
      featureSchemaVersion: params.featureSchemaVersion ?? null,
    };

    await this.db.insert(interventionRecommendations).values(row);

    // Redis sorted set: score = expiresAt ms so ZRANGEBYSCORE with now_ms finds expired entries
    const redisKey = `pending:store:${params.storeId}`;
    await this.redis.getRedis().zadd(redisKey, expiresAt.getTime(), id);
    // Key TTL = 2× approval window — expiry worker cleans up earlier
    await this.redis.getRedis().expire(redisKey, params.approvalTimeoutSeconds * 2);

    // Kafka audit (fire-and-forget — non-fatal)
    void this.producer
      .send(this.kafkaTopic, id, { event: 'generated', recommendationId: id, ...params })
      .catch((err: unknown) => {
        this.logger.warn({ err, id }, 'RecommendationService: Kafka produce failed (non-fatal)');
      });

    this.logger.info(
      { id, storeId: params.storeId, sessionId: params.sessionId, approvalMode: 'pending' },
      'Recommendation generated',
    );
    return id;
  }

  async get(id: string): Promise<InterventionRecommendation | null> {
    const [row] = await this.db
      .select()
      .from(interventionRecommendations)
      .where(eq(interventionRecommendations.id, id))
      .limit(1);
    return row ?? null;
  }

  async markApproved(id: string, adminId: number): Promise<void> {
    await this.db
      .update(interventionRecommendations)
      .set({ status: 'approved', approvedBy: adminId, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(interventionRecommendations.id, id));
  }

  async markRejected(id: string, adminId: number, storeId: number): Promise<void> {
    await this.db
      .update(interventionRecommendations)
      .set({ status: 'rejected', rejectedBy: adminId, rejectedAt: new Date(), updatedAt: new Date() })
      .where(eq(interventionRecommendations.id, id));
    // Best-effort Redis cleanup
    await this.redis.getRedis().zrem(`pending:store:${storeId}`, id).catch(() => {});
  }

  async markExecuted(id: string, interventionId: string): Promise<void> {
    await this.db
      .update(interventionRecommendations)
      .set({ status: 'executed', executedAt: new Date(), interventionId, updatedAt: new Date() })
      .where(eq(interventionRecommendations.id, id));
  }

  async markExpired(id: string, storeId: number): Promise<void> {
    await this.db
      .update(interventionRecommendations)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(interventionRecommendations.id, id));
    await this.redis.getRedis().zrem(`pending:store:${storeId}`, id).catch(() => {});
  }
}
