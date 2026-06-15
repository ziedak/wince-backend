import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

export const customers = pgTable(
  'customers',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    distinctId: text('distinct_id').notNull(),
    email: text('email'),
    emailHash: text('email_hash'),
    phone: text('phone'),
    emailConsent: boolean('email_consent').default(false),
    smsConsent: boolean('sms_consent').default(false),
    lifetimeValue: numeric('lifetime_value').default('0'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique('customers_store_distinct_unique').on(table.storeId, table.distinctId)],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
