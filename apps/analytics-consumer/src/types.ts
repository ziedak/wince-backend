/**
 * Shape of an enriched event as serialised by apps/enrichment-session and
 * published to the enriched-events Kafka topic.
 *
 * Field names intentionally mirror EnrichedEvent from
 * apps/enrichment-session/src/types.ts — keep in sync.
 */
export interface KafkaEnrichedEvent {
  event_id: string;
  event_type: string;
  session_id: string;
  distinct_id: string;
  store_id: number;
  timestamp: string;
  cart_value?: number;
  customer_email?: string;
  properties?: Record<string, unknown>;
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
 */
export interface ClickHouseRow {
  event_id: string;
  event_type: string;
  session_id: string;
  distinct_id: string;
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
  customer_email: string;
  properties: string;
}

/**
 * Parse and minimally validate raw JSON from Kafka.
 * Returns null when the payload is not a recognisable enriched event.
 */
export function parseEnrichedEvent(raw: unknown): KafkaEnrichedEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e['event_id'] !== 'string' || e['event_id'].length === 0) return null;
  if (typeof e['event_type'] !== 'string') return null;
  if (typeof e['session_id'] !== 'string') return null;
  if (typeof e['distinct_id'] !== 'string') return null;
  return e as unknown as KafkaEnrichedEvent;
}

/**
 * Map an enriched event to a ClickHouse-compatible row.
 */
export function toClickHouseRow(event: KafkaEnrichedEvent): ClickHouseRow {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    session_id: event.session_id,
    distinct_id: event.distinct_id,
    store_id: event.store_id,
    timestamp: event.timestamp,
    server_timestamp: event.server_timestamp,
    cart_value: event.cart_value ?? 0,
    customer_id: event.customer_id,
    lifetime_value: event.lifetime_value,
    email_consent: event.email_consent ? 1 : 0,
    sms_consent: event.sms_consent ? 1 : 0,
    rage_click_count: event.rage_click_count,
    is_frustrated: event.is_frustrated ? 1 : 0,
    session_available: event.session_available ? 1 : 0,
    customer_email: event.customer_email ?? '',
    properties: JSON.stringify(event.properties ?? {}),
  };
}
