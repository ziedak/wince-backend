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
  value: numeric('value'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedInOrderId: text('used_in_order_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type DiscountCode = typeof discountCodes.$inferSelect;
export type NewDiscountCode = typeof discountCodes.$inferInsert;
