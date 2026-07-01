import { createLogger } from '@org/logger';
import type { RedisClient } from '@org/redis_client';
import { dailyBudget, storeUsage, sql, type Db } from '@org/db';

// Lua script: atomically initialise the key (NX + EX) then check-and-increment.
// Returns 1 if the amount was reserved, 0 if budget would be exceeded.
// KEYS[1] = budget key, ARGV[1] = amount, ARGV[2] = maxAmount, ARGV[3] = ttlSeconds
const RESERVE_SCRIPT = `
local key = KEYS[1]
local amount = tonumber(ARGV[1])
local max_amount = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

-- Initialise with TTL if the key does not yet exist
redis.call('SET', key, '0', 'NX', 'EX', ttl)

local current = tonumber(redis.call('GET', key)) or 0
if current + amount > max_amount then
  return 0
end

redis.call('INCRBYFLOAT', key, tostring(amount))
return 1
`.trim();

export class BudgetService {
  private readonly logger = createLogger({ service: 'BudgetService' });

  constructor(
    private readonly db: Db,
    private readonly redisClient: RedisClient,
  ) {}

  /**
   * Atomically checks remaining daily budget and reserves `amount` if available.
   * Returns true when the amount was reserved, false when exhausted.
   * Fails open (returns true) on Redis error to avoid blocking legitimate interventions.
   */
  async checkAndReserve(storeId: number, amount: number, maxAmount: number): Promise<boolean> {
    if (amount <= 0) return true;

    const date = new Date().toISOString().slice(0, 10); // UTC date YYYY-MM-DD
    const key = `budget:${storeId}:${date}`;
    // Key lives for 48 h — covers midnight rollover safely
    const ttl = 172800;

    try {
      const redis = this.redisClient.getRedis();
      const result = await redis.eval(RESERVE_SCRIPT, 1, key, String(amount), String(maxAmount), String(ttl));
      const approved = result === 1;
      if (!approved) {
        this.logger.info({ storeId, amount, maxAmount }, 'BudgetService: daily budget exhausted');
      }
      return approved;
    } catch (err) {
      this.logger.warn({ err, storeId, amount }, 'BudgetService: Redis error, failing open');
      return true; // fail-open
    }
  }

  /**
   * Asynchronously reconciles the Redis counter into the PostgreSQL daily_budget table.
   * Called after delivery — does not block the intervention path.
   */
  async reconcile(storeId: number, amount: number): Promise<void> {
    try {
      const date = new Date().toISOString().slice(0, 10);
      await this.db
        .insert(dailyBudget)
        .values({ storeId, date, totalDiscountGiven: String(amount) })
        .onConflictDoUpdate({
          target: [dailyBudget.storeId, dailyBudget.date],
          set: {
            totalDiscountGiven: sql`${dailyBudget.totalDiscountGiven} + ${String(amount)}`,
          },
        });

      // Fire-and-forget: increment daily usage counters for billing dashboard.
      this.db
        .insert(storeUsage)
        .values({ storeId, date, interventionsSent: 1, revenueRecovered: String(amount) })
        .onConflictDoUpdate({
          target: [storeUsage.storeId, storeUsage.date],
          set: {
            interventionsSent: sql`${storeUsage.interventionsSent} + 1`,
            revenueRecovered: sql`${storeUsage.revenueRecovered} + ${String(amount)}`,
          },
        })
        .catch((err) =>
          this.logger.warn({ err, storeId }, 'BudgetService: store_usage increment failed (non-critical)'),
        );
    } catch (err) {
      this.logger.warn({ err, storeId, amount }, 'BudgetService: reconcile failed (non-critical)');
    }
  }
}
