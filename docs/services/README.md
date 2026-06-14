# Services

Detailed documentation for each runtime service in the platform.

## Edge and identity

- [API Gateway](api-gateway.md)
- [API Key Service](api-key-service.md)
- [Admin API](admin-api.md)

## Event pipeline

- [Ingestion Service](ingestion-service.md)
- [Enrichment & Session Service](enrichment-session-service.md)
- [Decision Engine](decision-engine.md)
- [Intervention Gateway](intervention-gateway.md)
- [Notification Service](notification-service.md)

## Operations and compliance

- [Ops and Compliance Services](ops-and-compliance.md)

The root [architecture overview](../ARCHITECTURE.md) links into these documents and should stay short.

## Runtime profile

| Service | Stack | Scale hint | Notes |
| --- | --- | --- | --- |
| API Gateway | Kong | 3-10 | Stateless edge routing and auth |
| API Key Service | Internal service | 2-5 | Tiny cache-backed lookup service |
| Admin API | NestJS | 2-5 | Stateless; trusts Kong-forwarded identity |
| Ingestion Service | Rust | 2-20 | Hot path; keep dependencies minimal |
| Enrichment & Session Service | NestJS | 3-32 | Redis-heavy session coordination |
| Decision Engine | NestJS + ONNX | 2-15 | Embedded inference and rules |
| Intervention Gateway | uWebSockets | 3-10 | Local socket map plus Redis routing metadata |
| Notification Service | NestJS | 2-8 | Fallback delivery only |
| Analytics Consumer | NestJS | 2-10 | Kafka consumer writing ClickHouse |
| Dead Letter Handler | Internal worker | 1-2 | Archive and alert on DLQ payloads |
| Audit Service | Internal worker | 1-2 | Immutable compliance records |
| Billing Service | Internal worker | 1-2 | Usage counters per store |
| Reconciliation Worker | Cron/leader job | 1 | Periodic integrity checks |
