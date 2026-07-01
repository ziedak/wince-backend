import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

export const processedEvents = pgTable('processed_events', {
  eventId: uuid('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow(),
  /** Nullable store_id — added for future date+store partitioning and tenant-scoped dedup windows. */
  storeId: integer('store_id'),
});

export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type NewProcessedEvent = typeof processedEvents.$inferInsert;
