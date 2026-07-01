import { integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

/**
 * Per-notification delivery record written by the Notification Service after
 * each dispatch attempt. Provides:
 *   - Audit trail for billing disputes (distinct from store_usage aggregates)
 *   - Debug evidence for delivery failures (provider error messages)
 *   - Source of truth for channel-level delivery rate analytics
 */
export const notificationLogs = pgTable('notification_logs', {
  id: serial('id').primaryKey(),
  interventionId: uuid('intervention_id'),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  distinctId: text('distinct_id'),
  /** 'email' | 'sms' | 'push' */
  channel: text('channel').notNull(),
  /** 'sent' | 'failed' | 'bounced' */
  status: text('status').notNull(),
  /** 'sendgrid' | 'twilio' | 'firebase' */
  provider: text('provider'),
  /** Provider-assigned message ID for tracing with the provider dashboard */
  providerId: text('provider_id'),
  error: text('error'),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
});

export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
