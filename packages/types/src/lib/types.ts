// ─── Identity & Session ────────────────────────────────────────────────────

export type EventSource = 'browser' | 'backend';

// ─── Browser SDK Event Schema ───────────────────────────────────────────────
// Canonical reference: docs/domains/tracking-model.md

export interface TrackEvent {
  /** UUID v7 event ID — primary dedupe key */
  eid: string;
  /** Per-session monotonic sequence number */
  seq: number;
  /** Event name, e.g. '$page_view', '$cart_add' */
  t: string;
  /** Client capture timestamp (ms since epoch) */
  ts: number;
  /** Session ID (UUID v4, sessionStorage) */
  sid: string;
  /** Anonymous device ID (UUID v4, localStorage) */
  anon: string;
  /** Identified user ID — set after identify() call */
  uid?: string;
  /** Event-specific properties */
  props?: Record<string, unknown>;
  /** Person traits to merge */
  $set?: Record<string, unknown>;
  /** Person traits written only if absent */
  $set_once?: Record<string, unknown>;
  /** Document URL at capture time */
  url?: string;
  /** Document referrer at capture time */
  ref?: string;
  /** Tab-scoped window ID */
  window_id?: string;
  /** Current page view ID */
  pageview_id?: string;
  /** sent_at - ts; added by SDK at encode time */
  offset?: number;
  /** Schema version — fixed at 1 */
  schema_v?: number;
}

/** Transport envelope sent by the browser SDK */
export interface TrackingEnvelope {
  /** Client-side timestamp when the batch was sent (ms since epoch) */
  sent_at: number;
  events: TrackEvent[];
}

// ─── Enriched / Server-side shapes ──────────────────────────────────────────

/** A TrackEvent as written to raw.events Kafka topic */
export interface RawKafkaEvent extends TrackEvent {
  /** Resolved store ID from API key (set by Kong → ingestion) */
  store_id: number;
  /** Event origin */
  source: EventSource;
  /** Server receive timestamp (ms since epoch) */
  server_received_at: number;
  /** Clock-skew corrected timestamp: ts + (server_received_at - sent_at) */
  adjusted_ts: number;
  /** Client IP address */
  ip: string;
}

/** A RawKafkaEvent after enrichment — written to enriched.events */
export interface EnrichedEvent extends RawKafkaEvent {
  /** Resolved customer ID (null for anonymous) */
  customer_id: string | null;
  /** Session cart value at the time of this event */
  cart_value: number;
  /** Rage-click count in this session */
  rage_click_count: number;
  /** Customer email if known (for interventions) */
  email?: string;
}

// ─── Store / API key context ─────────────────────────────────────────────────

export interface StoreContext {
  store_id: number;
  rate_limit_rps: number;
}

// ─── Kafka record shape ──────────────────────────────────────────────────────

export interface KafkaRecord {
  topic: string;
  /** Partition key */
  key: string;
  value: unknown;
}

