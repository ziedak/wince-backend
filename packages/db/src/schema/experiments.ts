import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

export const experiments = pgTable('experiments', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  variants: jsonb('variants').notNull(),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Experiment = typeof experiments.$inferSelect;
export type NewExperiment = typeof experiments.$inferInsert;
