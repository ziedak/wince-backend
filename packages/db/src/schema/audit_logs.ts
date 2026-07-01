import { boolean, customType, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { adminUsers } from './admin_users.js';

// PostgreSQL INET type for IP address storage
const inet = customType<{ data: string }>({
  dataType() {
    return 'inet';
  },
});

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  adminUserId: integer('admin_user_id').references(() => adminUsers.id),
  /** Store context for the action — nullable for system-level actions */
  storeId: integer('store_id'),
  action: text('action').notNull(),
  target: text('target'),
  details: jsonb('details'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  success: boolean('success').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
