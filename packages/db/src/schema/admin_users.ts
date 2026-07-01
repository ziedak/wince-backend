import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const adminUsers = pgTable('admin_users', {
  id: serial('id').primaryKey(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').default('viewer'),
  isActive: boolean('is_active').default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /** Incremented on each failed login attempt; reset to 0 on success */
  failedLoginAttempts: integer('failed_login_attempts').default(0),
  /** If set and in the future, login is blocked (brute-force lockout) */
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
