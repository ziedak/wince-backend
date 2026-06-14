# Analytics and Ops

Operational consumers and housekeeping tasks that do not belong to a single runtime service.

## Analytics consumer

- Consume enriched events, intervention logs, and notification logs.
- Write analytics data into ClickHouse.
- Update aggregate views and reporting tables.

## Dead letter handling

- Consume `dead.letters`.
- Archive payloads to S3.
- Emit alerts for errors that need attention.

## Audit and billing

- Store audit records for compliance.
- Update store usage counters for billing.

## Reconciliation

- Compare ingestion counters with analytics counters.
- Re-trigger stale interventions when needed.
- Clean up old Redis keys and stale operational state.
