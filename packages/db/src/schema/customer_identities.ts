import { integer, pgTable, serial, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';
import { customers } from './customers.js';

/**
 * Maps every distinct_id (anonymous or identified) to a canonical customer record.
 * A customer can have many distinct_ids across devices and sessions.
 *
 * Use this table — not customers.distinct_id — for identity resolution in
 * ExperimentService (variant bucketing) and CooldownService (per-user cooldown).
 * CustomerService.getOrCreate() upserts a row here on every new identity.
 */
export const customerIdentities = pgTable(
  'customer_identities',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    customerId: integer('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    distinctId: text('distinct_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('customer_identities_store_distinct_unique').on(table.storeId, table.distinctId),
  ],
);

export type CustomerIdentity = typeof customerIdentities.$inferSelect;
export type NewCustomerIdentity = typeof customerIdentities.$inferInsert;
