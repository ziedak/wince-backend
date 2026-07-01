import { integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';
import { interventions } from './interventions.js';

export const discountCodes = pgTable('discount_codes', {
  code: text('code').primaryKey(),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  sessionId: text('session_id'),
  interventionId: uuid('intervention_id').references(() => interventions.interventionId),
  /** 'percent' | 'fixed' | 'free_shipping' */
  discountType: text('discount_type').notNull().default('percent'),
  value: numeric('value'),
  /** Minimum cart value required to redeem this code */
  minCartValue: numeric('min_cart_value'),
  /** Maximum number of times this code can be redeemed (default 1 = single-use) */
  maxUses: integer('max_uses').default(1),
  /** Running count of successful redemptions */
  usedCount: integer('used_count').default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedInOrderId: text('used_in_order_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type DiscountCode = typeof discountCodes.$inferSelect;
export type NewDiscountCode = typeof discountCodes.$inferInsert;
