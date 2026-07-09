// ─── Identity & Session ────────────────────────────────────────────────────

export type EventSource = 'browser' | 'backend';

/**
 * Strips the browser SDK's transport prefix from an event `t` name, returning
 * the canonical action used for classification/matching throughout
 * decision-engine (and mirrored in Rust by `rust_shared_types::canonical_event_type`
 * for enrichment-session).
 *
 * The tracker-js SDK emits names like `$exit_intent`, `$user_idle`,
 * `$rage_click`, and `$cart_{action}` (e.g. `$cart_add`, `$cart_checkout_abandon`)
 * — see wince/packages/web/src/plugins/*.ts for the authoritative list.
 * Backend/webhook-originated events (e.g. `purchase`, `order_created`) are
 * already bare and pass through unchanged.
 *
 * MUST be used instead of comparing `t` directly — every prior direct
 * comparison against bare strings (`'exit_intent'`, `'checkout_abandon'`,
 * `'idle_timeout'`, ...) silently never matched in production because the
 * real values carry the `$`/`$cart_` prefix.
 */
export function canonicalEventType(t: string): string {
  if (t.startsWith('$cart_')) return t.slice('$cart_'.length);
  if (t.startsWith('$')) return t.slice(1);
  return t;
}

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
  /** Delivery priority hint ('critical' | 'high' | 'normal'). Forwarded
   * unchanged through ingestion/enrichment; used by decision-engine to
   * prioritize processing order within a Kafka batch. */
  priority?: 'critical' | 'high' | 'normal';
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

/**
 * Real-time feature vector computed by the Rust enrichment-session service.
 * Attached to every EnrichedEvent as a pre-computed window of session signals.
 * Optional fields are null when the underlying data is unavailable (e.g. no
 * cart line-items in the event payload). XGBoost treats null as a native
 * missing value — do NOT substitute zeros.
 */
export interface FeatureVector {
  // ── Rolling aggregates (ZCOUNT on per-type sorted sets) ─────────────────
  rage_clicks_30s: number;
  add_to_cart_60s: number;
  exit_intent_5m: number;
  // ── Recency (null = no prior event in this session) ──────────────────────
  seconds_since_last_event: number | null;
  seconds_since_last_add: number | null;
  seconds_since_last_checkout: number | null;
  // ── EWMA velocity ──────────────────────────────────────────────────────
  ewma_events_per_minute: number;
  ewma_scroll_velocity: number;
  /** Raw 30-second scroll velocity reported by the frontend on this event. */
  scroll_velocity_30s: number;
  // ── Pattern detection (Rust-side boolean logic) ──────────────────────────
  pattern_rage_after_add: boolean;
  pattern_exit_after_checkout: boolean;
  idle_after_high_cart: boolean;
  // ── Cart dynamics ─────────────────────────────────────────────────────────
  cart_value_delta_2m: number;
  // ── Funnel progress ───────────────────────────────────────────────────────
  checkout_progress_max: number | null;
  checkout_step_reached: number | null;
  // ── Session duration ──────────────────────────────────────────────────────
  time_on_site_total: number;
  // ── Behavioural entropy ───────────────────────────────────────────────────
  unique_event_types: number;
  // ── Intervention history ──────────────────────────────────────────────────
  interventions_shown_this_session: number;
  seconds_since_last_intervention: number | null;
  // ── Cart composition (null until cart-items schema added to ingestion) ────
  cart_item_count: number | null;
  cart_avg_item_price: number | null;
  cart_has_discount: boolean | null;
  cart_distinct_categories: number | null;
  // ── Funnel context (null until page-id schema added to ingestion) ─────────
  unique_pages_visited: number | null;
  // ── Schema versioning ─────────────────────────────────────────────────────
  feature_schema_version: string;
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
  /** Pre-computed feature vector from the Enrichment Service. Present on
   * session-bearing events; absent on bare page-view / identify events. */
  features?: FeatureVector;
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
  /** Canonical customer ID from customer_identities table */
  customerId?: number;
  distinctId: string;
  type: InterventionType;
  channel: InterventionChannel;
  /** Monetary value of the offer (discount amount, free-shipping threshold) */
  value?: number;
  /** Generated discount code, present when type = price_reduction */
  discountCode?: string;
  experimentId?: string;
  variant?: string;
  /** Why this intervention was triggered, e.g. 'checkout_abandon', 'exit_intent' */
  triggerReason?: string;
  decisionLatencyMs: number;
  confidenceScore?: number;
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

