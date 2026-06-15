import { date, integer, numeric, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

export const dailyBudget = pgTable(
  'daily_budget',
  {
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id),
    date: date('date').notNull(),
    totalDiscountGiven: numeric('total_discount_given').default('0'),
  },
  (table) => [primaryKey({ columns: [table.storeId, table.date] })],
);

export type DailyBudget = typeof dailyBudget.$inferSelect;
export type NewDailyBudget = typeof dailyBudget.$inferInsert;
