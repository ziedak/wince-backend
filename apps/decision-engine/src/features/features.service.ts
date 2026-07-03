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
}
