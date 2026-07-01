import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const stores = pgTable('stores', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** @deprecated Use api_keys table for multi-key support. Kept for Kong compatibility. */
  apiKeyHash: text('api_key_hash').notNull().unique(),
  /** @deprecated Use store_domains table for multi-domain support. Kept until callers migrated. */
  domain: text('domain'),
  plan: text('plan').default('free'),
  rateLimit: integer('rate_limit').default(1000),
  config: jsonb('config').default({}),
  isActive: boolean('is_active').default(true),
  isPendingDeletion: boolean('is_pending_deletion').default(false),
  timezone: text('timezone').default('UTC'),
  currency: text('currency').default('USD'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
