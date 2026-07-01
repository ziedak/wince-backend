import type { RedisClient } from '@org/redis_client';
import { eq, and, type Db } from '@org/db';
import { customers, customerIdentities } from '@org/db';
import type { CustomerData } from './types.js';
import type { EnrichmentMetrics } from './metrics.js';

const CUSTOMER_CACHE_TTL = 300; // 5 minutes

export class CustomerService {
  constructor(
    private readonly redis: RedisClient,
    private readonly db: Db,
    private readonly metrics: EnrichmentMetrics,
  ) {}

  async getOrCreate(storeId: number, distinctId: string): Promise<CustomerData | null> {
    const cacheKey = `cache:customer:${storeId}:${distinctId}`;

    // L1: Redis cache
    const cached = await this.redis.safeGet(cacheKey);
    if (cached) {
      return JSON.parse(cached) as CustomerData;
    }

    const t0 = Date.now();

    // L2: PostgreSQL lookup
    const rows = await this.db
      .select({
        id: customers.id,
        email: customers.email,
        lifetimeValue: customers.lifetimeValue,
        emailConsent: customers.emailConsent,
        smsConsent: customers.smsConsent,
      })
      .from(customers)
      .where(
        and(
          eq(customers.storeId, storeId),
          eq(customers.distinctId, distinctId),
        ),
      )
      .limit(1);

    this.metrics.dbQueryLatency('customer_lookup', Date.now() - t0);

    let customer: CustomerData | null = null;

    if (rows.length > 0) {
      const row = rows[0];
      customer = {
        id: row.id,
        email: row.email,
        lifetimeValue: parseFloat(row.lifetimeValue ?? '0'),
        emailConsent: row.emailConsent ?? false,
        smsConsent: row.smsConsent ?? false,
      };
    } else {
      // Create anonymous customer on first visit
      const created = await this.db
        .insert(customers)
        .values({ storeId, distinctId })
        .onConflictDoNothing()
        .returning({ id: customers.id });

      if (created.length > 0) {
        customer = {
          id: created[0].id,
          email: null,
          lifetimeValue: 0,
          emailConsent: false,
          smsConsent: false,
        };
      }
    }

    // Ensure identity mapping exists for this distinctId → customerId.
    // ON CONFLICT DO NOTHING is safe: the row already exists if we reach here on a re-visit.
    if (customer) {
      await this.db
        .insert(customerIdentities)
        .values({ storeId, customerId: customer.id, distinctId })
        .onConflictDoNothing();

      await this.redis.safeSet(cacheKey, JSON.stringify(customer), CUSTOMER_CACHE_TTL);
    }

    return customer;
  }
}
