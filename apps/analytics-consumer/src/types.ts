/**
 * Shape of an enriched event as serialised by apps/enrichment-session and
 * published to the enriched-events Kafka topic.
 *
 * Field names are canonical — mirror EnrichedEvent from @org/types (also
 * used by apps/decision-engine's Kafka consumer) — keep in sync.
 */
export interface KafkaEnrichedEvent {
  eid: string;
  t: string;
  sid: string;
  anon: string;
  uid?: string;
  store_id: number;
  ts: number;
  cart_value?: number;
  props?: Record<string, unknown>;
  /** Tracker-js contract version this event was produced under (informational only). */
  schema_v?: number;
  // Enriched fields added by enrichment-session
  customer_id: number | null;
  lifetime_value: number;
  email_consent: boolean;
  sms_consent: boolean;
  rage_click_count: number;
  is_frustrated: boolean;
  session_available: boolean;
  server_timestamp: string;
}

/**
 * Row shape written to ClickHouse.
 * Booleans are represented as UInt8 (0/1) for ClickHouse compatibility.
 * properties is serialised to JSON string.
 * Schema mirrors packages/db/src/schema/clickhouse/events.sql exactly.
 */
export interface ClickHouseRow {
  eid: string;
  t: string;
  sid: string;
  anon: string;
  store_id: number;
  timestamp: string;
  server_timestamp: string;
  cart_value: number;
  customer_id: number | null;
  lifetime_value: number;
  email_consent: number;
  sms_consent: number;
  rage_click_count: number;
  is_frustrated: number;
  session_available: number;
  properties: string;
}

/**
 * Parse and minimally validate raw JSON from Kafka.
 * Returns null when the payload is not a recognisable enriched event.
 */
export function parseEnrichedEvent(raw: unknown): KafkaEnrichedEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e['eid'] !== 'string' || e['eid'].length === 0) return null;
  if (typeof e['t'] !== 'string') return null;
  if (typeof e['sid'] !== 'string') return null;
  if (typeof e['anon'] !== 'string') return null;
  return e as unknown as KafkaEnrichedEvent;
}

/**
 * Map an enriched event to a ClickHouse-compatible row.
 */
export function toClickHouseRow(event: KafkaEnrichedEvent): ClickHouseRow {
  return {
    eid: event.eid,
    t: event.t,
    sid: event.sid,
    anon: event.anon,
    store_id: event.store_id,
    timestamp: new Date(event.ts).toISOString(),
    server_timestamp: event.server_timestamp,
    cart_value: event.cart_value ?? 0,
    customer_id: event.customer_id,
    lifetime_value: event.lifetime_value,
    email_consent: event.email_consent ? 1 : 0,
    sms_consent: event.sms_consent ? 1 : 0,
    rage_click_count: event.rage_click_count,
    is_frustrated: event.is_frustrated ? 1 : 0,
    session_available: event.session_available ? 1 : 0,
    properties: JSON.stringify(event.props ?? {}),
  };
}
