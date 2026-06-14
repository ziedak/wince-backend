# Ops and Compliance Services

Grouped documentation for the operational consumers and compliance-oriented services.

## Analytics Consumer

- Consume `enriched.events`, `intervention.log`, `notification.log` (consumer group `analytics-group`).
- Write to ClickHouse `events` table using batching: flush at 10,000 events or every 5 seconds, whichever comes first.
- Update materialized views for pre-aggregated daily metrics.
- Keep reporting workloads off the operational PostgreSQL path.

## Dead Letter Handler

- Consume `dead.letters` (consumer group `dlq-group`).
- Archive each message to S3: `s3://dlq/{date}/{topic}/{partition}_{offset}.json`.
- DLQ message schema: `{ original_topic, original_partition, original_offset, error, payload, timestamp }`.
- Send a Slack alert for every DLQ message with an error summary.
- Preserve enough context to replay or diagnose failed messages later.

## Audit Service

- Consume `intervention.log` and `audit.log` (consumer group `audit-group`).
- Persist immutable records in PostgreSQL `audit_logs` for compliance.

## Billing Service

- Consume `notification.log` and `intervention.log` (consumer group `billing-group`).
- Update PostgreSQL `store_usage` table: event counts, prediction counts, and notification counts per store per day.
- Expose a usage endpoint that the Admin API calls to retrieve billing data.

## Reconciliation Worker

- Runs every 6 hours with leader election (single active instance).
- Compares Prometheus counters: `ingestion_events_accepted_total` vs `clickhouse_events_written_total`. Alerts if discrepancy > 0.1%.
- Checks for interventions older than 1 h with `delivered = false` and re-triggers via Notification Service (idempotent).
- Verifies that daily budget counters in PostgreSQL match the sum of discount codes redeemed.
- Cleans up stale Redis keys (`session:*`, `ws:active:*`) that have outlived their TTL.
- Prefer idempotent reprocessing over custom one-off repair logic.
