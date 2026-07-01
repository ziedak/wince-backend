import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

export const experiments = pgTable('experiments', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  variants: jsonb('variants').notNull(),
  active: boolean('active').default(true),
  /** Primary metric being measured, e.g. 'recovery_rate', 'revenue', 'click_rate' */
  metric: text('metric'),
  /** Statistical confidence level for significance testing — default 95% */
  confidenceLevel: numeric('confidence_level').default('0.95'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Experiment = typeof experiments.$inferSelect;
export type NewExperiment = typeof experiments.$inferInsert;
