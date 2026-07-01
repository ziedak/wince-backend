import { integer, pgTable, serial, unique } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin_users.js';
import { stores } from './stores.js';

/**
 * Junction table granting an admin user access to specific stores.
 * Replaces the admin_users.store_ids integer[] anti-pattern:
 *   - CASCADE on both sides ensures FK integrity
 *   - Supports precise permission grants without array membership queries
 *   - Works correctly with PgBouncer transaction-mode pooling
 */
export const adminUserStores = pgTable(
  'admin_user_stores',
  {
    id: serial('id').primaryKey(),
    adminUserId: integer('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
  },
  (table) => [unique('admin_user_stores_unique').on(table.adminUserId, table.storeId)],
);

export type AdminUserStore = typeof adminUserStores.$inferSelect;
export type NewAdminUserStore = typeof adminUserStores.$inferInsert;
