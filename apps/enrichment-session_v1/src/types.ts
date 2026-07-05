export interface RawEvent {
  event_id: string;
  event_type: string;
  session_id: string;
  distinct_id: string;
  store_id: number;
  timestamp: string;
  cart_value?: number;
  customer_email?: string;
  properties?: Record<string, unknown>;
}

export interface CustomerData {
  id: number;
  email: string | null;
  lifetimeValue: number;
  emailConsent: boolean;
  smsConsent: boolean;
}

export interface SessionState {
  cartValue: number;
  rageClickCount: number;
  lastActivity: number;
  isFrustrated: boolean;
}

export interface EnrichedEvent extends RawEvent {
  customer_id: number | null;
  lifetime_value: number;
  email_consent: boolean;
  sms_consent: boolean;
  rage_click_count: number;
  is_frustrated: boolean;
  session_available: boolean;
  server_timestamp: string;
}

export type EnrichResult =
  | { kind: 'enriched'; event: EnrichedEvent }
  | { kind: 'duplicate' };
