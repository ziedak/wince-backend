import { bigint, date, integer, numeric, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

export const storeUsage = pgTable(
  'store_usage',
  {
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id),
    date: date('date').notNull(),
    eventsCount: bigint('events_count', { mode: 'number' }).default(0),
    predictionsCount: bigint('predictions_count', { mode: 'number' }).default(0),
    notificationsSent: bigint('notifications_sent', { mode: 'number' }).default(0),
    interventionsSent: bigint('interventions_sent', { mode: 'number' }).default(0),
    revenueRecovered: numeric('revenue_recovered').default('0'),
  },
  (table) => [primaryKey({ columns: [table.storeId, table.date] })],
);

export type StoreUsage = typeof storeUsage.$inferSelect;
export type NewStoreUsage = typeof storeUsage.$inferInsert;
