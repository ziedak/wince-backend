# ARCHITECTURE DOCUMENT - SOURCE OF TRUTH

## AI Hyper-Personalized Cart Recovery Suite

**Version:** 2.0 (Final)  
**Date:** 2025-06-14  
**Status:** Approved for implementation

This document is the global entry point for the backend architecture. It should stay short and describe the system shape, the major boundaries, and where the detailed documentation lives.

## System Overview

The platform is a real-time, event-driven backend that ingests commerce events, enriches them with customer and session context, decides whether to intervene, and delivers interventions through WebSocket first with notification fallback.

Core principles:

- Kafka is the durable event log.
- Kubernetes is the runtime platform.
- Browser tracker events and WooCommerce backend tracker events are both first-class sources.
- API keys are used for tracker ingestion at the edge.
- Kong is the identity enforcement point for human/admin access.
- Each service owns its own operational detail.

## Technical Observations

- Kong is the public edge for tracker, admin, and websocket traffic.
- The API Key Service exists only to resolve `store_id` and small policy metadata for tracker ingestion.
- PostgreSQL is the source of truth for business state, budgets, interventions, experiments, and processed-event tracking.
- Redis holds short-lived session state, API-key cache, dedupe filters, cooldown markers, and websocket presence metadata.
- ClickHouse stores derived analytics and reporting views, not authoritative business state.
- Kafka carries raw events, enriched events, intervention decisions, notification outcomes, and dead-letter traffic.
- HPA scales stateless services on CPU and memory; KEDA scales Kafka consumers on lag.
- PgBouncer should sit in front of PostgreSQL to prevent connection exhaustion.
- Terraform provisions clusters and dependencies; ArgoCD or equivalent applies GitOps sync.

## Kafka Topics & Schemas

| Topic | Partitions | Key | Producer(s) | Consumer(s) |
| --- | --- | --- | --- | --- |
| `raw.events` | 64 | `session_id` | Ingestion Service | Enrichment & Session Service |
| `enriched.events` | 64 | `session_id` | Enrichment & Session Service | Decision Engine, Analytics Consumer |
| `intervention.log` | 16 | `session_id` | Decision Engine | Analytics Consumer, Audit, Billing |
| `notification.log` | 16 | `session_id` | Notification Service | Analytics Consumer, Billing |
| `dead.letters` | 8 | `session_id` | Any service after retries are exhausted | Dead Letter Handler |
| `audit.log` | 8 | `store_id` | Admin API, Key/identity services | Audit Service |

- Replication factor 3, min ISR 2, compression `snappy`.
- Operational topics retain for 7 days; `dead.letters` retains for 30 days.
- All topics use JSON payloads with versioned schemas. No Avro Schema Registry for v1.
- Kafka stays the durable log; services should not rely on it as a workflow engine.

### Consumer groups

| Group | Topics |
| --- | --- |
| `enrichment-group` | `raw.events` |
| `decision-group` | `enriched.events` |
| `analytics-group` | `enriched.events`, `intervention.log`, `notification.log` |
| `audit-group` | `audit.log`, `intervention.log` |
| `billing-group` | `notification.log`, `intervention.log` |
| `dlq-group` | `dead.letters` |

- `enable.auto.commit=false` — commit after each batch.
- `max.poll.records=500`, `fetch.max.bytes=10MB`.
- `session.timeout.ms=10000`, `max.poll.interval.ms=300000`.
- Partition assignment: `CooperativeStickyAssignor` (incremental rebalancing).

## Event Processing Flows

- Normal tracking flow: browser or WooCommerce event -> Kong -> Ingestion -> `raw.events` -> Enrichment -> `enriched.events` -> Analytics.
- Real-time intervention flow: `enriched.events` -> Decision Engine -> Intervention Gateway -> WebSocket ACK, with Notification Service fallback when delivery fails.
- Attribution flow: discount or purchase events are matched back to intervention records and written to PostgreSQL/ClickHouse derived views.

## Error Handling, Retries & Idempotency

- Ingestion retries Kafka writes three times with 100ms backoff, then writes to `dead.letters`.
- Notification retries temporary delivery failures up to three times with exponential backoff, then writes to `dead.letters`.
- Enrichment uses Redis Bloom filters for fast duplicate detection and falls back to PostgreSQL `processed_events` when the Bloom result is ambiguous.
- The Decision Engine should treat missing gateway sessions as a fallback-to-notification case, not as a hard failure.

## Observability Targets

- Track ingestion throughput, Kafka lag, Redis hit rate, API-key lookup latency, decision latency, and intervention delivery success rate.
- Alert when Kafka lag grows beyond safe consumer capacity, when rejection rates spike, or when delivery failures rise above baseline.

## Non-Functional Requirements

| Category | Target |
| --- | --- |
| Event throughput | 10,000 events/sec |
| Prediction latency | p99 under 200 ms from abandonment to intervention push |
| Availability | 99.95% monthly |
| RPO | 0 once Kafka acknowledgement is durable |
| RTO | under 5 minutes for stateless services |
| Tenant isolation | no cross-store leakage |
| Cost | under $0.50 per 1,000 events |

## Decisions Log

- Keep Kafka as the durable event log with 64 partitions for the main event topics.
- Embed ONNX in the Decision Engine instead of using a separate inference service.
- Use Redis Bloom filters for idempotency instead of per-event keys.
- Use PgBouncer in front of PostgreSQL.
- Use uWebSockets for intervention delivery instead of Socket.io.

Auth flow detail lives in [domains/security.md](domains/security.md). Tracker-source details live in [domains/tracking-model.md](domains/tracking-model.md).

## Documentation Map

### Service docs

- [Services index](services/README.md)
- [API Gateway](services/api-gateway.md)
- [API Key Service](services/api-key-service.md)
- [Admin API](services/admin-api.md)
- [Ingestion Service](services/ingestion-service.md)
- [Enrichment & Session Service](services/enrichment-session-service.md)
- [Decision Engine](services/decision-engine.md)
- [Intervention Gateway](services/intervention-gateway.md)
- [Notification Service](services/notification-service.md)
- [Ops and Compliance Services](services/ops-and-compliance.md)

### Domain docs

- [Domains index](domains/README.md)
- [Data Stores](domains/data-stores.md)
- [Security](domains/security.md)
- [Observability and Deployment](domains/observability-deployment.md)
- [Tracking Model](domains/tracking-model.md)
- [Revenue Attribution and A/B Testing](domains/revenue-attribution-ab-testing.md)
- [Analytics and Ops](domains/analytics-and-ops.md)

## Service Catalog Summary

| Area | Primary doc |
| --- | --- |
| Edge routing and auth | [services/api-gateway.md](services/api-gateway.md), [services/api-key-service.md](services/api-key-service.md), [services/admin-api.md](services/admin-api.md) |
| Event ingestion and enrichment | [services/ingestion-service.md](services/ingestion-service.md), [services/enrichment-session-service.md](services/enrichment-session-service.md) |
| Decisioning and intervention | [services/decision-engine.md](services/decision-engine.md), [services/intervention-gateway.md](services/intervention-gateway.md), [services/notification-service.md](services/notification-service.md) |
| Shared operations | [services/ops-and-compliance.md](services/ops-and-compliance.md) |

## Global Architecture Rules

- Admin authentication is handled by Kong-validated JWTs issued by the Admin API login flow.
- Tracker ingestion uses API keys only.
- Identity should be resolved at the edge and forwarded as trusted context.
- PII stays out of analytics stores.
- The detailed implementation, error handling, and field-level behavior belong in the service and domain docs.
- The detailed service docs should capture runtime limits, retries, cache behavior, and failure handling, not just responsibilities.

End of document.
