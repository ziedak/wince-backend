# Ingestion Service

Rust service that accepts tracker batches from the browser SDK and WooCommerce backend tracker, then publishes validated events to Kafka.

## Responsibilities

- Accept `POST /v1/track` with a batch of browser or backend tracker events.
- Validate the API key through the API Key Service.
- Validate each event against JSON Schema.
- Add server-side fields such as timestamp, IP, user agent, and store ID.
- Sanitize obvious PII before the event leaves the service.
- Publish to `raw.events` keyed by `session_id`.
- Treat ingestion as the hottest path and keep dependency count low.

## API contract

- `POST /v1/track`
- Header: `X-API-Key`
- Response: `202 Accepted` with accepted and rejected counts

## Idempotency and failure handling

- Treat `eid` (UUID v7) as the dedupe key when it is present.
- Reject malformed events without stopping the rest of the batch.
- Retry Kafka writes three times with 100ms backoff, then write the payload to `dead.letters`.

## Notes

- This is the hottest ingest path, so keep dependencies minimal.
- Avoid coupling it to human auth or admin concerns.
- The service should remain stateless aside from ephemeral request processing and downstream publication retries.
