# Enrichment & Session Service — Detailed Documentation

## Overview

The Enrichment & Session Service is a TypeScript (Node.js) Kafka consumer that enriches raw tracking events with customer and session context. It bridges the gap between raw ingestion and downstream decisioning by resolving identities, maintaining session state, and forwarding high-priority trigger events to the decision-engine via a low-latency fast path.

**Key characteristics:**
- **Language & Runtime:** TypeScript, Node.js
- **Default Port:** 3002
- **Input:** `raw.events` Kafka topic
- **Output:** `enriched.events` Kafka topic
- **Fast Path:** Direct HTTP POST to `decision-engine /v1/trigger` for trigger events (sub-100ms latency)
- **Consumers:** `analytics-consumer`, `decision-engine`, `notification-service`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Kafka Cluster                             │
│  raw.events ──▶ enrichment-session ──▶ enriched.events      │
└───────────────────────────┬─────────────────────────────────┘
                            │ consumes
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Enrichment & Session Service                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Consumer   │─▶│   Enricher   │─▶│   Producer       │  │
│  │ (consumer.ts)│  │ (enricher.ts)│  │ (kafka producer) │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│         │                 │                    │            │
│         ▼                 ▼                    ▼            │
│  ┌────────────┐   ┌─────────────┐   ┌──────────────┐       │
│  │   Redis    │   │ PostgreSQL  │   │ decision-    │       │
│  │ (session,  │   │ (customers, │   │ engine HTTP  │       │
│  │  cache,    │   │  processed, │   │ (trigger FW) │       │
│  │  bloom)    │   │  idempotency)│   │              │       │
│  └────────────┘   └─────────────┘   └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Downstream Consumers                            │
│   analytics-consumer │ decision-engine │ notification-service │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Module | File | Responsibility |
|--------|------|----------------|
| **main** | `src/main.ts` | Bootstrap, dependency wiring, health server, graceful shutdown |
| **config** | `src/config.ts` | Environment-based configuration |
| **consumer** | `src/consumer.ts` | Kafka consumer loop, batch processing, retry logic, DLQ routing |
| **enricher** | `src/enricher.ts` | Orchestrates idempotency, session, customer enrichment |
| **session** | `src/session.ts` | Redis session state management, rage-click detection |
| **customer** | `src/customer.ts` | PostgreSQL customer lookup/create, Redis cache layer |
| **idempotency** | `src/idempotency.ts` | Redis Bloom filter + PostgreSQL confirmed duplicate detection |
| **trigger-forwarder** | `src/trigger-forwarder.ts` | Low-latency HTTP forward to decision-engine for trigger events |
| **health** | `src/health.ts` | Liveness/readiness probes, Kafka lag metrics |
| **metrics** | `src/metrics.ts` | Prometheus metrics wrapper via `@org/monitoring` |
| **types** | `src/types.ts` | TypeScript interfaces for raw, enriched, customer, session |

## Data Flow

### Request Lifecycle

1. **Consume** — Reads `raw.events` from Kafka in batches (max `MAX_POLL_RECORDS`, default 500). Uses cooperative rebalancing for zero-downtime scaling.
2. **Parse** — Deserializes JSON `RawEvent`. Invalid JSON → DLQ.
3. **Idempotency check** — Checks Redis Bloom filter `idem:bloom`. On hit, confirms via PostgreSQL `processed_events`. Duplicates skip processing.
4. **Enrich** — Runs `Enricher.enrich()`:
   - **Customer lookup** — Redis L1 cache (`cache:customer:{store_id}:{distinct_id}`, TTL 5 min) → PostgreSQL L2. Creates anonymous customer on first visit. Ensures identity mapping row exists.
   - **Session update** — Redis hash `session:{session_id}`. Updates cart value (delta on `add_to_cart`/`remove_from_cart`), rage-click count, last activity, TTL 30 min. Maintains sorted set `active:sessions` for stale scanner. Detects frustration via 30-second sliding window (≥3 rage clicks).
   - **Context persistence** — Fire-and-forget `setContext` writes identity fields to session hash for decision-engine reconstruction.
5. **Produce** — Publishes `EnrichedEvent` to `enriched.events` keyed by `session_id`. Only marked as processed after confirmed produce (at-least-once semantics).
6. **Fast path** — For trigger events (`checkout_abandon`, `exit_intent`, `rage_click`, `add_to_cart`), forwards directly to `decision-engine /v1/trigger` via HTTP POST with 500 ms timeout. Kafka publish still happens for durability.
7. **Commit** — Manual offset management; commits after batch completion.

### Retry Strategy

- **Enrichment retries:** 3 attempts with exponential backoff (100 ms, 200 ms, 400 ms).
- **Produce retries:** Same 3-attempt backoff.
- **Backoff on enrichment failure:** 5-second pause with `state.backingOff = true` (health check reflects this).
- **DLQ routing:** Events that exhaust retries or have invalid JSON go to `kafkaDlqTopic` (`dead.letters`).

## API Contract

### Internal HTTP Trigger Forwarding

`POST {decisionEngineUrl}/v1/trigger`

**Headers:**
- `Content-Type: application/json`
- `X-Internal-Secret: <INTERNAL_SECRET>`

**Body (canonical `EnrichedEvent`):**
```json
{
  "eid": "01906b67-0000-7000-8000-000000000001",
  "seq": 0,
  "t": "rage_click",
  "ts": 1700000000000,
  "sid": "session-abc",
  "anon": "anon-123",
  "props": {},
  "store_id": 42,
  "source": "backend",
  "server_received_at": 1700000000000,
  "adjusted_ts": 1700000000000,
  "ip": "",
  "customer_id": 123,
  "cart_value": 0,
  "rage_click_count": 4,
  "is_frustrated": true,
  "lifetime_value": 1500,
  "email": "user@example.com",
  "email_consent": true,
  "sms_consent": false,
  "session_available": true
}
```

**Expected response:** `202 Accepted`

**Behavior:**
- Only trigger events are forwarded (`checkout_abandon`, `exit_intent`, `rage_click`, `add_to_cart`).
- 500 ms hard timeout — if decision-engine doesn't respond, the event is still safely published to Kafka.
- Non-202 responses and errors are logged but never block the pipeline.

### Health Endpoints

- **GET /live** — Always 200 if process is running.
- **GET /ready** — 200 only if subscribed to Kafka, not backing off, and both Redis + PostgreSQL are reachable. Returns 503 otherwise.
- **GET /metrics** — Prometheus metrics text format.

## Configuration

Configuration is loaded from environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_BROKERS` | `kafka:29092` | Comma-separated Kafka bootstrap brokers |
| `KAFKA_RAW_TOPIC` | `raw.events` | Input topic |
| `KAFKA_ENRICHED_TOPIC` | `enriched.events` | Output topic |
| `KAFKA_DLQ_TOPIC` | `dead.letters` | Dead-letter queue for failed events |
| `KAFKA_CONSUMER_GROUP` | `enrichment-group` | Consumer group ID |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `POSTGRES_PGBOUNCER` | `postgresql://admin:password@pgbouncer:6432/app_db` | PostgreSQL connection (via PgBouncer) |
| `BLOOM_FILTER_KEY` | `idem:bloom` | Redis Bloom filter key prefix |
| `SESSION_TTL_SECONDS` | `1800` | Session hash and sorted set TTL (30 min) |
| `MAX_POLL_RECORDS` | `500` | Max records per Kafka poll |
| `COMMIT_INTERVAL_MS` | `5000` | Minimum time between offset commits |
| `PORT` | `3002` | Health/metrics HTTP port |
| `DECISION_ENGINE_URL` | `http://decision-engine:3007` | Decision-engine base URL for trigger forwarding |
| `INTERNAL_SECRET` | `dev-internal-secret` | Shared secret for internal HTTP calls |

## Dependencies

### Core Runtime

| Package | Purpose |
|---------|---------|
| `@org/kafka_client` | Kafka consumer/producer wrapper |
| `@org/redis_client` | Redis multiplexed client |
| `@org/db` | Drizzle ORM PostgreSQL client |

### Internal Packages

| Package | Purpose |
|---------|---------|
| `@org/logger` | Structured logging |
| `@org/monitoring` | Prometheus metrics collector |
| `@org/types` | Shared TypeScript type definitions |

## Data Stores

### Redis

**Keys used:**

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `session:{session_id}` | Hash | 1800 s (30 min) | Session state: `cart_value`, `rage_click_count`, `last_activity`, `is_frustrated`, `customer_id`, `distinct_id`, identity fields |
| `session:{session_id}:rage_ts` | List | 1800 s | Sliding window timestamps for rage-click detection |
| `cache:customer:{store_id}:{distinct_id}` | String | 300 s (5 min) | Customer data cache |
| `active:sessions` | Sorted Set | auto-expire | Tracks active sessions by `last_activity` score (used by stale scanner) |
| `idem:bloom` | Bloom Filter | persistent | Deduplication Bloom filter |

### PostgreSQL

**Tables used:**

| Table | Purpose |
|-------|---------|
| `customers` | Persistent customer records (`storeId`, `distinctId`, `email`, `lifetimeValue`, `emailConsent`, `smsConsent`) |
| `customer_identities` | Identity mapping (`storeId`, `customerId`, `distinctId`) for cross-device ID resolution |
| `processed_events` | Confirmed processed `eventId` values for Bloom false-positive elimination |

## Trigger Event Forwarding

Trigger events bypass the normal Kafka-only path and are forwarded directly to the decision-engine's `/v1/trigger` endpoint using an HTTP POST. This achieves sub-100ms end-to-end latency for time-sensitive interventions.

**Supported trigger events:**
- `checkout_abandon`
- `exit_intent`
- `rage_click`
- `add_to_cart`

**Mechanism:**
1. After enrichment succeeds and the event is produced to Kafka, `TriggerForwarder.maybeForward()` is called.
2. If the event type matches, the event is mapped to the canonical `EnrichedEvent` schema expected by the decision-engine.
3. A `fetch()` request is sent with `X-Internal-Secret` auth and a 500 ms `AbortController` timeout.
4. Errors (network, timeout, non-202 response) are logged but never propagate; Kafka remains the durable source of truth.

## Idempotency

Two-layer deduplication ensures events are processed exactly once:

1. **Redis Bloom filter** — Fast probabilistic check. `BF.EXISTS` against `idem:bloom`.
2. **PostgreSQL `processed_events`** — Deterministic confirmation on Bloom hit. Prevents false-positive skips.

Only after confirmed processing (successful produce) is the event recorded in both stores via `markProcessed()`.

## Session Model

Sessions are short-lived (30-min TTL) Redis hashes:

```
session:{session_id} = {
  cart_value: float,
  rage_click_count: int,
  last_activity: timestamp_ms,
  is_frustrated: "0"|"1",
  customer_id: string,
  distinct_id: string,
  email: string,
  email_consent: "0"|"1",
  sms_consent: "0"|"1",
  store_id: string
}
```

**Rage-click detection:** Maintains a list of recent rage-click timestamps (`session:{session_id}:rage_ts`). Computes a 30-second sliding window count; frustation threshold is ≥3 clicks.

**Frustration state:** `is_frustrated` is persisted back to the hash after each event, allowing the decision-engine stale scanner to read it without reconstructing from timestamps.

## Observability

### Metrics (Prometheus)

| Metric | Type | Description |
|--------|------|-------------|
| `enrichment_events_processed_total` | Counter | Events processed, tagged `status=success\|dropped\|deduplicated` |
| `enrichment_processing_latency_seconds` | Histogram | End-to-end enrichment + produce latency |
| `enrichment_db_query_latency_seconds` | Histogram | DB query latency, tagged `operation=customer_lookup\|session_update` |
| `enrichment_kafka_lag` | Gauge | Consumer lag per partition |
| `enrichment_redis_bloom_false_positive` | Counter | Bloom false positives confirmed by PostgreSQL |

### Health State

The `ConsumerState` object tracks:
- `subscribed` — whether the consumer has joined the group and subscribed to `raw.events`.
- `backingOff` — true during 5-second backoff after repeated enrichment failures.

Health checks use these to prevent traffic during degraded states.

## Graceful Shutdown

On SIGTERM/SIGINT:
1. Sets `isShuttingDown = true` to stop processing new messages.
2. Waits for the in-flight batch to finish (bounded by 30 s).
3. Shuts down Kafka consumer and producer.
4. Stops health server.
5. Disconnects Redis and PostgreSQL.
6. Exits process.

## Error Handling

| Failure | Handling |
|---------|----------|
| Invalid JSON | → DLQ, continue batch |
| Bloom false positive | Confirmed with PostgreSQL; if not duplicate, process normally |
| Enrichment failure (after 3 retries) | → DLQ, 5 s backoff |
| Produce failure (after 3 retries) | → DLQ |
| Redis/PostgreSQL transient error | Retried via `withRetry` (100/200/400 ms backoff) |
| Decision-engine trigger timeout | Logged, non-fatal (Kafka path still durable) |
| Session update failure | Degrades gracefully (`session_available: false`) |

## Deployment

### Kafka Consumer Configuration

- **Group ID:** `enrichment-group`
- **Rebalancing:** `useCooperativeRebalancing: true` (`CooperativeStickyAssignor`) for incremental partition assignment without stop-the-world revokes.
- **Auto-commit:** Disabled (manual commits after batch).
- **Session timeout:** 30 s
- **Heartbeat interval:** 3 s
- **Max in-flight requests:** 1

### Docker

Multi-stage build similar to ingestion; however the service compiles to a plain Node.js runtime image. Nx `@nx/node` executor handles build/test targets.

### Nx Integration

Standard Node.js Nx targets (`build`, `test`, `lint`, `run`).

## Testing

Unit-testable components:
- `Enricher` — pure orchestration logic with mocked `IdempotencyService`, `SessionService`, `CustomerService`.
- `SessionService` — integration tests against Redis.
- `TriggerForwarder` — unit tests for event type filtering and canonical mapping.

Run tests via:
```bash
nx test enrichment-session