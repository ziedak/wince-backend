import type {
  TrackEvent,
  TrackingEnvelope,
  RawKafkaEvent,
  EnrichedEvent,
  StoreContext,
  KafkaRecord,
} from './types.js';

describe('TrackingEnvelope shape', () => {
  it('accepts a minimal valid envelope', () => {
    const event: TrackEvent = {
      eid: '018f4e2a-7b1c-7d3e-9f5a-1234567890ab',
      seq: 1,
      t: '$page_view',
      ts: 1700000000000,
      sid: 'sid-001',
      anon: 'anon-001',
    };
    const envelope: TrackingEnvelope = { sent_at: 1700000001000, events: [event] };
    expect(envelope.events).toHaveLength(1);
    expect(envelope.events[0].eid).toBe('018f4e2a-7b1c-7d3e-9f5a-1234567890ab');
  });

  it('allows optional fields to be omitted', () => {
    const event: TrackEvent = {
      eid: 'eid-1',
      seq: 0,
      t: '$cart_add',
      ts: Date.now(),
      sid: 'sid-1',
      anon: 'anon-1',
    };
    expect(event.uid).toBeUndefined();
    expect(event.props).toBeUndefined();
  });
});

describe('RawKafkaEvent shape', () => {
  it('extends TrackEvent with server fields', () => {
    const raw: RawKafkaEvent = {
      eid: 'eid-2',
      seq: 5,
      t: '$checkout_start',
      ts: 1700000000000,
      sid: 'sid-2',
      anon: 'anon-2',
      store_id: 42,
      source: 'browser',
      server_received_at: 1700000001000,
      adjusted_ts: 1700000001200,
      ip: '1.2.3.4',
    };
    expect(raw.store_id).toBe(42);
    expect(raw.source).toBe('browser');
  });
});

describe('StoreContext and KafkaRecord', () => {
  it('StoreContext holds store_id and rate_limit_rps', () => {
    const ctx: StoreContext = { store_id: 1, rate_limit_rps: 500 };
    expect(ctx.store_id).toBe(1);
  });

  it('KafkaRecord holds topic, key, value', () => {
    const rec: KafkaRecord = { topic: 'raw.events', key: 'sid-1', value: { foo: 'bar' } };
    expect(rec.topic).toBe('raw.events');
  });
});

describe('EnrichedEvent shape', () => {
  it('extends RawKafkaEvent with enrichment fields', () => {
    const enriched: EnrichedEvent = {
      eid: 'eid-3',
      seq: 1,
      t: '$page_view',
      ts: 1700000000000,
      sid: 'sid-3',
      anon: 'anon-3',
      store_id: 1,
      source: 'browser',
      server_received_at: 1700000000500,
      adjusted_ts: 1700000000600,
      ip: '10.0.0.1',
      customer_id: 'cust-99',
      cart_value: 129.99,
      rage_click_count: 0,
    };
    expect(enriched.customer_id).toBe('cust-99');
    expect(enriched.cart_value).toBe(129.99);
  });
});
