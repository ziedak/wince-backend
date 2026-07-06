import { createLogger } from '@org/logger';
import type { CacheService } from '@org/cache';
import { policyRules, eq, and, type Db } from '@org/db';

export interface Policy {
  cooldownSeconds: number;
  minCartValue: number;
  maxDailyBudgetAmount: number;
  discountValue: number;
  pendingTtlSeconds: number;
  enableInShop: boolean;
  enableEmail: boolean;
  enableSms: boolean;
  /** Whether interventions require admin approval before execution. */
  approvalMode: 'manual' | 'auto_if_budget' | 'auto_always';
  /** Seconds before a pending recommendation expires with no action taken. */
  approvalTimeoutSeconds: number;
  /** Scope of the budget counter (per_day resets at midnight UTC). */
  budgetMode: 'per_day' | 'per_campaign' | 'unlimited';
}

const DEFAULT_POLICY: Policy = {
  cooldownSeconds: 3600,
  minCartValue: 10,
  maxDailyBudgetAmount: 100,
  discountValue: 10,
  pendingTtlSeconds: 1800,
  enableInShop: true,
  enableEmail: false,
  enableSms: false,
  approvalMode: 'manual',
  approvalTimeoutSeconds: 600,
  budgetMode: 'per_day',
};

const CACHE_TTL_SECONDS = 300; // 5 minutes

export class PolicyService {
  private readonly logger = createLogger({ service: 'PolicyService' });

  constructor(
    private readonly db: Db,
    private readonly cache: CacheService,
  ) {}

  async getPolicy(storeId: number): Promise<Policy | null> {
    try {
      return await this.cache.getOrCompute<Policy>(
        `policy:store:${storeId}`,
        () => this.loadFromDb(storeId),
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn({ err, storeId }, 'PolicyService: failed to load policy, using null (fail-open)');
      return null;
    }
  }

  private async loadFromDb(storeId: number): Promise<Policy> {
    const rules = await this.db
      .select()
      .from(policyRules)
      .where(and(eq(policyRules.storeId, storeId), eq(policyRules.enabled, true)));

    const policy = { ...DEFAULT_POLICY };

    for (const rule of rules) {
      // Each rule's `parameters` JSON object overrides specific policy fields.
      // Store owners configure rules with keys matching Policy interface fields.
      const params = rule.parameters as Partial<Policy>;
      Object.assign(policy, params);
    }

    this.logger.debug({ storeId, rulesCount: rules.length }, 'PolicyService: policy loaded from DB');
    return policy;
  }

  async invalidate(storeId: number): Promise<void> {
    await this.cache.invalidate(`policy:store:${storeId}`);
  }
}
