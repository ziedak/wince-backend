import type { NewInterventionEvent } from '@org/db';
import type { KafkaEnrichedEvent } from './types.js';

/** Prefix used by the tracker SDK for intervention lifecycle events. */
const INTERVENTION_EVENT_PREFIX = '$intervention_';

/**
 * Row shape written to ClickHouse `intervention_events` table.
 * Schema mirrors packages/db/src/schema/clickhouse/intervention_events.sql exactly.
 */
export interface InterventionEventRow {
  event_id: string;
  intervention_id: string;
  store_id: number;
  distinct_id: string;
  event_type: string;
  reason: string;
  variant: string;
  experiment_id: string;
  timestamp: string;
  properties: string;
}

/** True when the event is an intervention lifecycle event (shown/clicked/etc.). */
export function isInterventionLifecycleEvent(t: string): boolean {
  return t.startsWith(INTERVENTION_EVENT_PREFIX);
}

/**
 * Parse an enriched intervention lifecycle event into a ClickHouse row.
 * Returns null when `props.intervention_id` is missing — these events cannot
 * be attributed to an intervention and are not analytics-worthy on their own.
 */
export function parseInterventionEventRow(event: KafkaEnrichedEvent): InterventionEventRow | null {
  const props = event.props ?? {};
  const interventionId = props['intervention_id'];
  if (typeof interventionId !== 'string' || interventionId.length === 0) {
    return null;
  }

  const eventType = event.t.slice(INTERVENTION_EVENT_PREFIX.length);
  const reason = props['reason'] ?? props['dismissed_reason'] ?? props['suppressed_reason'] ?? '';
  const variant = props['variant'] ?? '';
  const experimentId = props['experiment_id'] ?? '';

  return {
    event_id: event.eid,
    intervention_id: interventionId,
    store_id: event.store_id,
    distinct_id: event.anon,
    event_type: eventType,
    reason: typeof reason === 'string' ? reason : '',
    variant: typeof variant === 'string' ? variant : '',
    experiment_id: typeof experimentId === 'string' ? experimentId : '',
    timestamp: new Date(event.ts).toISOString(),
    properties: JSON.stringify(props),
  };
}

/** Map a parsed ClickHouse intervention row to a PostgreSQL insert row. */
export function toPostgresInterventionEvent(row: InterventionEventRow): NewInterventionEvent {
  return {
    interventionId: row.intervention_id,
    storeId: row.store_id,
    eventType: row.event_type,
    reason: row.reason.length > 0 ? row.reason : null,
    occurredAt: new Date(row.timestamp),
  };
}
