import { integer, pgTable, serial, text, unique } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

/**
 * Allowed domains per store for CORS validation and API key resolution.
 * Replaces stores.domain (single TEXT) for multi-domain support.
 * stores.domain is kept until all callers are migrated to query this table.
 */
export const storeDomains = pgTable(
  'store_domains',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    domain: text('domain').notNull(),
  },
  (table) => [unique('store_domains_store_domain_unique').on(table.storeId, table.domain)],
);

export type StoreDomain = typeof storeDomains.$inferSelect;
export type NewStoreDomain = typeof storeDomains.$inferInsert;
