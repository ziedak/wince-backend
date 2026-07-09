import { integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { stores } from './stores.js';
import { interventions } from './interventions.js';

/**
 * Full lifecycle event log for each intervention interaction.
 * Written by apps/analytics-consumer (not enrichment-session — that service
 * has no Postgres business-logic write path) when it consumes
 * $intervention_shown, $intervention_dismissed, $intervention_clicked,
 * $intervention_accepted, $intervention_ignored, $intervention_suppressed
 * events from the enriched.events Kafka topic. See
 * apps/analytics-consumer/src/intervention-events.ts.
 *
 * Complements the boolean flags on the interventions table with a full
 * timestamped sequence for funnel analytics and CTR computation.
 * Also mirrored to ClickHouse intervention_events_local for aggregated reporting.
 */
export const interventionEvents = pgTable('intervention_events', {
  id: serial('id').primaryKey(),
  interventionId: uuid('intervention_id')
    .notNull()
    .references(() => interventions.interventionId),
  storeId: integer('store_id')
    .notNull()
    .references(() => stores.id),
  /** 'shown' | 'dismissed' | 'clicked' | 'accepted' | 'ignored' | 'suppressed' */
  eventType: text('event_type').notNull(),
  /** dismissed_reason or suppressed_reason from the tracker event props */
  reason: text('reason'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export type InterventionEvent = typeof interventionEvents.$inferSelect;
export type NewInterventionEvent = typeof interventionEvents.$inferInsert;
