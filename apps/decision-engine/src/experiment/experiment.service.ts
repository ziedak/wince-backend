import { createLogger } from '@org/logger';
import type { CacheService } from '@org/cache';
import { experiments, eq, and, lte, type Db } from '@org/db';

export interface ExperimentVariant {
  name: string;
  weight: number; // 0–100
}

export interface ExperimentConfig {
  id: number;
  name: string;
  variants: ExperimentVariant[];
}

const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * FNV-1a 32-bit hash — stable across restarts, no crypto overhead.
 * Same input always produces same bucket: deterministic experiment assignment.
 */
function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export class ExperimentService {
  private readonly logger = createLogger({ service: 'ExperimentService' });

  constructor(
    private readonly db: Db,
    private readonly cache: CacheService,
  ) {}

  /**
   * Returns the variant name for this (distinctId, storeId) pair.
   * Returns 'control' when no active experiment exists.
   * The assignment is deterministic and sticky: same ID → same bucket.
   */
  async getVariant(storeId: number, distinctId: string): Promise<string> {
    try {
      const config = await this.loadConfig(storeId);
      if (!config) return 'control';

      const bucket = fnv1a(`${distinctId}:${config.id}`) % 100;

      let cumulative = 0;
      for (const variant of config.variants) {
        cumulative += variant.weight;
        if (bucket < cumulative) return variant.name;
      }

      return 'control';
    } catch (err) {
      this.logger.warn({ err, storeId, distinctId }, 'ExperimentService: failed, using control');
      return 'control';
    }
  }

  private async loadConfig(storeId: number): Promise<ExperimentConfig | null> {
    return this.cache.getOrCompute<ExperimentConfig | null>(
      `experiment:${storeId}:config`,
      () => this.fetchActiveExperiment(storeId),
      CACHE_TTL_SECONDS,
    );
  }

  private async fetchActiveExperiment(storeId: number): Promise<ExperimentConfig | null> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(experiments)
      .where(
        and(
          eq(experiments.storeId, storeId),
          eq(experiments.active, true),
          lte(experiments.startTime, now),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;

    const row = rows[0]!;
    return {
      id: row.id,
      name: row.name,
      variants: row.variants as ExperimentVariant[],
    };
  }

  async invalidate(storeId: number): Promise<void> {
    await this.cache.invalidate(`experiment:${storeId}:config`);
  }
}
