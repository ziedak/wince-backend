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
  /** Resolved customer DB id (null for anonymous) */
  customer_id: number | null;
  /** Session cart value at the time of this event */
  cart_value: number;
  /** Rage-click count in this session */
  rage_click_count: number;
  /** True when rage-click or rapid-scroll frustration signal detected */
  is_frustrated: boolean;
  /** Customer lifetime value in store currency */
  lifetime_value: number;
  /** Customer email if known */
  email?: string;
  /** Customer opted in to email marketing */
  email_consent: boolean;
  /** Customer opted in to SMS marketing */
  sms_consent: boolean;
  /** True when an active session record was found during enrichment */
  session_available: boolean;
}

// ─── Intervention types ──────────────────────────────────────────────────────

export type InShopInterventionType =
  | 'popup'
  | 'countdown'
  | 'free_shipping'
  | 'price_reduction';

export type OffShopInterventionType = 'email' | 'sms';

export type InterventionType = InShopInterventionType | OffShopInterventionType;

export type InterventionChannel = 'in_shop' | 'off_shop';

/**
 * Written to the `interventions` table and `intervention.log` Kafka topic
 * by InterventionWriter immediately before delivery is attempted.
 */
export interface InterventionRecord {
  /** uuidv5(namespace, event.eid + '|' + distinctId) — idempotency key */
  interventionId: string;
  sessionId: string;
  storeId: number;
  distinctId: string;
  type: InterventionType;
  channel: InterventionChannel;
  /** Monetary value of the offer (discount amount, free-shipping threshold) */
  value?: number;
  /** Generated discount code, present when type = price_reduction */
  discountCode?: string;
  experimentId?: string;
  variant?: string;
  decisionLatencyMs: number;
  inferenceConfidence?: number;
}

/**
 * Payload sent by Decision Engine to Intervention Gateway POST /v1/push
 * (internal, bypasses Kong). Also stored in Redis intervention:pending key
 * and delivered to tracker.js via WebSocket or REST poll.
 */
export interface InShopPayload {
  interventionId: string;
  type: InShopInterventionType;
  value?: number;
  discountCode?: string;
  /** ISO-8601 expiry timestamp — used by countdown interventions */
  expiresAt?: string;
}

/**
 * Payload sent by Decision Engine to Notification Service POST /v1/notify
 * (internal, bypasses Kong). Notification Service checks consent flags
 * before dispatching to SendGrid / Twilio.
 */
export interface NotificationRequest {
  interventionId: string;
  sessionId: string;
  storeId: number;
  distinctId: string;
  type: OffShopInterventionType;
  /** DB template_id for SendGrid / Twilio template lookup */
  templateId: string;
  email?: string;
  phone?: string;
  emailConsent: boolean;
  smsConsent: boolean;
  /** Dynamic template variables merged into the template */
  templateData: {
    discountCode?: string;
    cartValue?: number;
    [key: string]: unknown;
  };
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

