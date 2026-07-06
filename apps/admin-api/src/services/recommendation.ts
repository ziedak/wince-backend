import {
  interventionRecommendations,
  policyRules,
  eq,
  and,
  isNull,
  type Db,
  type InterventionRecommendation,
} from '@org/db';

export interface ListParams {
  storeId?: number;
  status?: string;
  limit: number;
  offset: number;
}

export interface StoreSettingsPatch {
  approvalMode?: 'manual' | 'auto_if_budget' | 'auto_always';
  approvalTimeoutSeconds?: number;
  budgetMode?: 'per_day' | 'per_campaign' | 'unlimited';
}

export interface RecommendationPatch {
  type?: string;
  channel?: string;
  value?: number;
}

/**
 * Thin read/write service for intervention_recommendations, used by the Admin API.
 * The Decision Engine owns lifecycle writes (generate, markExecuted, markExpired).
 * Admin API is responsible for reject, patch, and store-settings upserts.
 */
export class RecommendationReadService {
  constructor(private readonly db: Db) {}

  async list(params: ListParams): Promise<InterventionRecommendation[]> {
    const conditions = [];
    if (params.storeId !== undefined) {
      conditions.push(eq(interventionRecommendations.storeId, params.storeId));
    }
    if (params.status !== undefined) {
      conditions.push(eq(interventionRecommendations.status, params.status));
    }

    const query = this.db
      .select()
      .from(interventionRecommendations)
      .orderBy(interventionRecommendations.createdAt)
      .limit(params.limit)
      .offset(params.offset);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async get(id: string): Promise<InterventionRecommendation | null> {
    const [row] = await this.db
      .select()
      .from(interventionRecommendations)
      .where(eq(interventionRecommendations.id, id))
      .limit(1);
    return row ?? null;
  }

  async reject(id: string, adminId: number): Promise<void> {
    await this.db
      .update(interventionRecommendations)
      .set({
        status: 'rejected',
        rejectedBy: adminId,
        rejectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(interventionRecommendations.id, id));
  }

  async patch(id: string, data: RecommendationPatch): Promise<void> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.type !== undefined) updates['type'] = data.type;
    if (data.channel !== undefined) updates['channel'] = data.channel;
    if (data.value !== undefined) updates['value'] = String(data.value);

    await this.db
      .update(interventionRecommendations)
      .set(updates as Parameters<typeof this.db.update>[0] extends { set: (v: infer S) => unknown } ? S : never)
      .where(eq(interventionRecommendations.id, id));
  }

  /**
   * Upserts the store's intervention-approval settings into `policy_rules`.
   * Settings are stored as a single row with ruleType='intervention_settings'.
   * On conflict the parameters JSONB is merged with the new values.
   */
  async upsertStoreSettings(storeId: number, settings: StoreSettingsPatch): Promise<void> {
    const RULE_TYPE = 'intervention_settings';

    const [existing] = await this.db
      .select()
      .from(policyRules)
      .where(
        and(
          eq(policyRules.storeId, storeId),
          eq(policyRules.ruleType, RULE_TYPE),
          isNull(policyRules.enabled),
        ),
      )
      .limit(1);

    const [existingEnabled] = existing
      ? [existing]
      : await this.db
          .select()
          .from(policyRules)
          .where(and(eq(policyRules.storeId, storeId), eq(policyRules.ruleType, RULE_TYPE)))
          .limit(1);

    if (existingEnabled) {
      const merged = { ...(existingEnabled.parameters as object), ...settings };
      await this.db
        .update(policyRules)
        .set({ parameters: merged, updatedAt: new Date() })
        .where(eq(policyRules.id, existingEnabled.id));
    } else {
      await this.db.insert(policyRules).values({
        storeId,
        ruleType: RULE_TYPE,
        parameters: settings as Record<string, unknown>,
        enabled: true,
      });
    }
  }
}
