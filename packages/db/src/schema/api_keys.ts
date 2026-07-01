import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

/**
 * Per-store API keys with rotation and revocation support.
 * Replaces the single stores.api_key_hash column for multi-key scenarios.
 * stores.api_key_hash is kept as deprecated for Kong compatibility until
 * the Kong plugin is migrated to query this table.
 */
export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull().unique(),
  /** Human-readable label, e.g. 'browser-tracker', 'woocommerce', 'staging' */
  label: text('label'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
