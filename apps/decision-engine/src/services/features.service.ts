import { createLogger } from '@org/logger';
import type { CacheService } from '@org/cache';
import type { IClickHouseClient } from '@org/clickhouse_client';
import type { DecisionMetrics } from '../metrics.js';

export interface CustomerFeatures {
  abandonment_rate_7d: number;
  avg_cart_value_30d: number;
}

const ZERO_FEATURES: CustomerFeatures = {
  abandonment_rate_7d: 0,
  avg_cart_value_30d: 0,
};

const CACHE_TTL_SECONDS = 3600; // 1 hour

interface ClickHouseRow {
  abandonment_rate_7d: string | number;
  avg_cart_value_30d: string | number;
}

export class FeatureService {
  private readonly logger = createLogger({ service: 'FeatureService' });

  constructor(
    private readonly clickhouse: IClickHouseClient,
    private readonly cache: CacheService,
    private readonly metrics: DecisionMetrics,
  ) {}

  async getFeatures(storeId: number, distinctId: string): Promise<CustomerFeatures> {
    const key = `feature:${storeId}:${distinctId}`;

    try {
      return await this.cache.getOrCompute<CustomerFeatures>(
        key,
        () => this.fetchFromClickHouse(storeId, distinctId),
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn({ err, storeId, distinctId }, 'FeatureService: failed, returning zero features');
      this.metrics.featureDegraded();
      return { ...ZERO_FEATURES };
    }
  }

  private async fetchFromClickHouse(storeId: number, distinctId: string): Promise<CustomerFeatures> {
    const start = Date.now();
    try {
      const rows = await this.clickhouse.execute<ClickHouseRow[]>(
        `SELECT abandonment_rate_7d, avg_cart_value_30d
         FROM mv_customer_features
         WHERE store_id = {storeId:UInt32} AND distinct_id = {distinctId:String}
         LIMIT 1`,
        { storeId, distinctId },
      );
      this.metrics.dbOperation('clickhouse', 'feature_fetch', Date.now() - start);

      if (!rows || rows.length === 0) return { ...ZERO_FEATURES };

      const row = rows[0]!;
      return {
        abandonment_rate_7d: Number(row.abandonment_rate_7d) || 0,
        avg_cart_value_30d: Number(row.avg_cart_value_30d) || 0,
      };
    } catch (err) {
      this.metrics.dbOperation('clickhouse', 'feature_fetch_error', Date.now() - start);
      this.logger.warn({ err, storeId, distinctId }, 'FeatureService: ClickHouse query failed');
      this.metrics.featureDegraded();
      return { ...ZERO_FEATURES };
    }
  }

  /**
   * Pre-fetches features for multiple entries in a single ClickHouse query and
   * populates the cache. Subsequent individual `getFeatures()` calls for these
   * entries will be cache hits — no extra I/O.
   *
   * Used by the stale scanner to batch-fetch features for all stale sessions
   * before processing them individually, avoiding N sequential ClickHouse queries.
   */
  async prefetchBatch(entries: Array<{ storeId: number; distinctId: string }>): Promise<void> {
    if (entries.length === 0) return;

    const cacheKeys = entries.map((e) => `feature:${e.storeId}:${e.distinctId}`);

    // Identify which entries are already cached
    let cachedValues: Array<CustomerFeatures | null>;
    try {
      cachedValues = await this.cache.mGet<CustomerFeatures>(cacheKeys);
    } catch {
      cachedValues = cacheKeys.map(() => null);
    }

    const missing = entries.filter((_, i) => cachedValues[i] === null);
    if (missing.length === 0) return;

    // Group missing entries by storeId for efficient IN-clause queries
    const byStore = new Map<number, Array<{ distinctId: string; cacheKey: string }>>();
    for (const e of missing) {
      const cacheKey = `feature:${e.storeId}:${e.distinctId}`;
      const group = byStore.get(e.storeId) ?? [];
      group.push({ distinctId: e.distinctId, cacheKey });
      byStore.set(e.storeId, group);
    }

    for (const [storeId, group] of byStore) {
      const distinctIds = group.map((g) => g.distinctId);
      try {
        const start = Date.now();
        const rows = await this.clickhouse.execute<Array<ClickHouseRow & { distinct_id: string }>>(
          `SELECT distinct_id, abandonment_rate_7d, avg_cart_value_30d
           FROM mv_customer_features
           WHERE store_id = {storeId:UInt32} AND distinct_id IN ({distinctIds:Array(String)})`,
          { storeId, distinctIds },
        );
        this.metrics.dbOperation('clickhouse', 'feature_batch_fetch', Date.now() - start);

        const rowMap = new Map(
          (rows ?? []).map((r) => [
            r.distinct_id,
            {
              abandonment_rate_7d: Number(r.abandonment_rate_7d) || 0,
              avg_cart_value_30d: Number(r.avg_cart_value_30d) || 0,
            } satisfies CustomerFeatures,
          ]),
        );

        // Populate cache (zero features for misses)
        const toCache: Record<string, CustomerFeatures> = {};
        for (const { distinctId, cacheKey } of group) {
          toCache[cacheKey] = rowMap.get(distinctId) ?? { ...ZERO_FEATURES };
        }
        await this.cache.mSet(toCache, CACHE_TTL_SECONDS).catch(() => {});
      } catch (err) {
        this.logger.warn({ err, storeId, count: group.length }, 'FeatureService: batch prefetch failed (non-fatal)');
        this.metrics.featureDegraded();
      }
    }
  }
}
