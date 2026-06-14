# Enrichment & Session Service

Consumes raw events, updates session state, enriches customer context, and republishes events.

## Responsibilities

- Consume `raw.events` from the `enrichment-group`.
- Resolve customer and session state.
- Store session data in Redis with a short TTL.
- Enrich each event with customer and session features.
- Publish the enriched event to `enriched.events`.
- Join browser activity, authenticated customer identity, and backend commerce state into one session view.

## Processing flow

- Look up customer by `(store_id, distinct_id)` in PostgreSQL (cached in Redis `cache:customer:{store_id}:{distinct_id}`, TTL 5 min). Create an anonymous record if not found.
- Load session state from Redis `session:{session_id}` (Hash). Initialize if missing: `{cart_value: 0, rage_click_count: 0, last_activity: timestamp}`.
- Update session state based on event type.
- Write session state back to Redis with TTL 30 min.
- Enrich the event with `customer_email`, `lifetime_value`, `session.cart_value`, `session.rage_click_count`, `session.is_frustrated`.
- Publish the enriched event with `session_id` as the Kafka key.

## Idempotency

- Client supplies `eid` (UUID v7). Check Redis Bloom filter `idem:bloom` on every event.
- On a Bloom filter hit (potential duplicate), fall back to PostgreSQL `processed_events` table. If confirmed duplicate, skip processing.
- Bloom filter config: 6 B expected items, 0.1% false positive rate (~8 GB).
- Use `CooperativeStickyAssignor` for incremental rebalancing so large consumer groups can scale without unnecessary partition churn.

## Retry handling

- On Redis or PostgreSQL timeout: retry 3 times with exponential backoff (100, 200, 400 ms). After final failure, write to `dead.letters`.

## Notes

- This service is the bridge between raw tracking data and downstream decisioning.
- Keep the session model small and resilient to partial state loss.
- Session loss should degrade behavior gracefully rather than blocking the pipeline.
