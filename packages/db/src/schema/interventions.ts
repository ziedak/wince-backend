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
  /** Why this intervention was triggered, e.g. 'checkout_abandon', 'exit_intent', 'idle_timeout' */
  triggerReason: text('trigger_reason'),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow(),
  /** When the tracker confirmed the intervention was visible to the user */
  shownAt: timestamp('shown_at', { withTimezone: true }),
  /** When the user clicked the intervention CTA */
  clickedAt: timestamp('clicked_at', { withTimezone: true }),
  /** When the user dismissed the intervention */
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  /** When the user explicitly accepted the offer */
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  /** When revenue attribution was computed */
  attributedAt: timestamp('attributed_at', { withTimezone: true }),
  /** Attribution window in hours — default 24h per docs/domains/revenue-attribution-ab-testing.md */
  attributionWindowHours: integer('attribution_window_hours').default(24),
  delivered: boolean('delivered').default(false),
  deliveredVia: text('delivered_via'),
  converted: boolean('converted').default(false),
  revenueAttributed: numeric('revenue_attributed'),
  experimentId: text('experiment_id'),
  variant: text('variant'),
  decisionLatencyMs: integer('decision_latency_ms'),
  confidenceScore: numeric('confidence_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type Intervention = typeof interventions.$inferSelect;
export type NewIntervention = typeof interventions.$inferInsert;
