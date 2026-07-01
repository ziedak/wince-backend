import {
  boolean,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { stores } from './stores.js';

export const interventions = pgTable('interventions', {
  id: serial('id').primaryKey(),
  interventionId: uuid('intervention_id').notNull().unique(),
  sessionId: text('session_id').notNull(),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  distinctId: text('distinct_id'),
  type: text('type').notNull(),
  channel: text('channel').notNull().default('in_shop'),
  value: numeric('value'),
  discountCode: text('discount_code'),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
  delivered: boolean('delivered').default(false),
  deliveredVia: text('delivered_via'),
  converted: boolean('converted').default(false),
  revenueAttributed: numeric('revenue_attributed'),
  experimentId: text('experiment_id'),
  variant: text('variant'),
  decisionLatencyMs: integer('decision_latency_ms'),
  inferenceConfidence: numeric('inference_confidence'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Intervention = typeof interventions.$inferSelect;
export type NewIntervention = typeof interventions.$inferInsert;
