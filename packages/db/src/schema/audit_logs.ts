import { customType, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
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
  action: text('action').notNull(),
  target: text('target'),
  details: jsonb('details'),
  ipAddress: inet('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
