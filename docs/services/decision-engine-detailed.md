# Decision Engine — Detailed Documentation

## Overview

The Decision Engine is the core AI/reasoning service of the WiNCE platform. It consumes enriched events from Kafka, evaluates whether an intervention is warranted using a hybrid rule engine + ONNX inference pipeline, and dispatches interventions through the appropriate delivery channel.

**Key characteristics:**
- **Language & Runtime:** TypeScript, Node.js
- **Default Port:** 3007
- **Input:** `enriched.events` Kafka topic
- **Output:** `intervention.log` Kafka topic, PostgreSQL `interventions` table, plus delivery to `intervention-gateway` or `notification-service`
- **Fast-path:** Also exposes `POST /v1/trigger` for sub-100ms trigger delivery from `enrichment-session`
- **Consumers:** `intervention-gateway`, `notification-service`, analytics pipelines

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Kafka Cluster                             │
│  enriched.events ──▶ decision-engine ──▶ intervention.log   │
└───────────────────────────┬─────────────────────────────────┘
                            │ consumes
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Decision Engine                           │
│  ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │ DecisionConsumer│─▶│DecisionOrchestr│─▶│ OutboundSvc  │ │
│  │(kafka/consumer) │  │(intervention/) │  │(outbound/)   │ │
│  └─────────────────┘  └────────────────┘  └──────────────┘ │
│         │                    │                      │       │
│         ▼                    ▼                      ▼       │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐ │
│  │ Policy       │   │ RiskScorer   │   │ intervention-   │ │
│  │ (PostgreSQL) │   │ (rules+ONNX) │   │ gateway HTTP    │ │
│  └──────────────┘   └──────────────┘   └─────────────────┘ │
│                                      │                     │
│                                      ▼                     │
│                             ┌─────────────────┐           │
│                             │ notification-   │           │
│                             │ service HTTP    │           │
│                             └─────────────────┘           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Background Workers                        │
│  ┌──────────────┐              ┌──────────────────────────┐ │
│  │ Scheduler    │              │ StaleScanner              │ │
│  │ Worker       │              │ (5 min scan)              │ │
│  └──────────────┘              └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

```Mermaid
flowchart TD
    subgraph "Kafka"
        A[enriched.events] --> B[Decision Engine]
        B --> C[intervention.log]
    end

    subgraph "Decision Engine"
        D[DecisionConsumer] --> E[DecisionOrchestrator]
        E --> F[Risk Scorer]
        E --> G[Intervention Pipeline]
        F --> H[Policy Service]
        F --> I[Cooldown Service]
        F --> J[Features Service]
        F --> K[Inference Service ONNX]
        G --> L[Budget Service]
        G --> M[Discount Service]
        G --> N[Outbound Service]
    end

    subgraph "Background Workers"
        O[Scheduler Worker] --> E
        P[Stale Scanner] --> E
    end

    subgraph "Storage"
        H --> Q[(PostgreSQL)]
        I --> R[(Redis)]
        J --> S[(ClickHouse)]
        K --> T[(ONNX Model)]
    end

    subgraph "Outbound"
        N --> U[Intervention Gateway]
        N --> V[Notification Service]
    end

```
### Component Responsibilities

| Module | File | Responsibility |
|--------|------|----------------|
| **main** | `src/main.ts` | Bootstrap, dependency wiring, health server, graceful shutdown |
| **config** | `src/config.ts` | Environment-based configuration |
| **kafka/decision.consumer** | `src/kafka/decision.consumer.ts` | Kafka consumer loop, trigger event filtering, DLQ routing |
| **intervention/intervention.service** | `src/intervention/intervention.service.ts` | Two-phase decision orchestrator (risk scoring + intervention pipeline) |
| **intervention/intervention.writer** | `src/intervention/intervention.writer.ts` | Kafka + PostgreSQL intervention audit writer |
| **trigger/trigger.handler** | `src/trigger/trigger.handler.ts` | Fast-path HTTP handler for `POST /v1/trigger` |
| **risk/risk-scorer.service** | `src/risk/risk-scorer.service.ts` | Hybrid risk score (rules + ONNX), threshold gate |
| **rules/rules.service** | `src/rules/rules.service.ts` | Deterministic rule engine |
| **inference/inference.service** | `src/inference/inference.service.ts` | ONNX model inference wrapper |
| **features/features.service** | `src/features/features.service.ts` | ClickHouse batch feature fetch with Redis cache |
| **session-features/session-features.service** | `src/session-features/session-features.service.ts` | Redis session hash reader, synthetic event builder |
| **policy/policy.service** | `src/policy/policy.service.ts` | Store policy load from PostgreSQL with Redis cache |
| **cooldown/cooldown.service** | `src/cooldown/cooldown.service.ts` | Per-store/customer cooldown state |
| **budget/budget.service** | `src/budget/budget.service.ts` | Daily budget check and reserve |
| **lock/lock.service** | `src/lock/lock.service.ts` | Session and cart-level distributed locks |
| **experiment/experiment.service** | `src/experiment/experiment.service.ts` | A/B experiment variant assignment |
| **discount/discount.service** | `src/discount/discount.service.ts` | Unique discount code generation |
| **outbound/outbound.service** | `src/outbound/outbound.service.ts` | Delivery routing to intervention-gateway or notification-service |
| **scheduler/scheduler.service** | `src/scheduler/scheduler.service.ts` | Redis sorted-set delayed re-evaluation queue |
| **scheduler/scheduler.worker** | `src/scheduler/scheduler.worker.ts` | Periodic worker that pops due sessions and re-evaluates |
| **stale-scanner/stale-scanner.service** | `src/stale-scanner/stale-scanner.service.ts` | Detects abandoned sessions via `active:sessions` sorted set |
| **health** | `src/health.ts` | Liveness/readiness probes, metrics |
| **metrics** | `src/metrics.ts` | Prometheus metrics wrapper |

## Data Flow

### Kafka-Path Decision Lifecycle

1. **Consume** — Reads `enriched.events` from Kafka. Only events with `t` in `TRIGGER_EVENTS` (`checkout_abandon`, `exit_intent`, `idle_timeout`) proceed; all others are skipped.
2. **Parse** — Deserializes JSON `EnrichedEvent`. Invalid JSON → DLQ.
3. ** Orchestrate** — `DecisionOrchestrator.decide()` runs the two-phase pipeline:

**Phase 1 — Risk Scoring:**
1. **Policy load** — Fetches store policy from PostgreSQL via Redis cache (`policy:store:{store_id}`, TTL 5 min). Returns defaults on cache miss.
2. **Cooldown gate** — Fast Redis `GET cooldown:{store_id}:{customerId}`. If active, skip.
3. **Feature fetch** — ClickHouse `mv_customer_features` query via Redis cache (`feature:{store_id}:{distinctId}`, TTL 1 h). Returns zero features on failure.
4. **Risk scoring** — Runs `RuleEngine.evaluate()` and `InferenceService.predict()` in parallel. ONNX confidence overrides rules only when confidence > `RISK_THRESHOLD` (0.6). Rules type/channel/value always authoritative.
5. **Persist score** — Fire-and-forget write to Redis `risk:{sessionId}` (TTL 60 s).
6. **Threshold gate** — If score < 0.6, schedule re-evaluation via `SchedulerService` and return.

**Phase 2 — Intervention Pipeline:**
7. **Sent guard** — Cheap Redis check (`lock:sent:{sessionId}`) before lock acquisition.
8. **Session lock** — Distributed Redis lock (`lock:session:{sessionId}`, TTL ~10 s) prevents concurrent decisions for the same session.
9. **Cart lock** — If `cart_id` present in props, acquires `lock:cart:{cartId}` to prevent duplicate interventions across tabs.
10. **Budget gate** — Reserves `discountValue` from daily budget (`budget:{storeId}:{date}`) in PostgreSQL.
11. **Experiment** — Assigns variant via `hash(distinct_id) % 100` bucketing against store experiment config.
12. **Discount code** — Generates unique code only for monetary in-shop offers (`price_reduction`, `free_shipping`).
13. **Write record** — Fire-and-forget insert to PostgreSQL `interventions` + Kafka `intervention.log`. Audit integrity preserved via Kafka DLQ on writer failure.
14. **Outbound delivery** — Routes to:
   - **in_shop:** `POST {gatewayUrl}/v1/push` with 100 ms hard timeout
   - **off_shop:** `POST {notificationUrl}/v1/notify` (no timeout; retried by notification-service)
15. **Mark delivered** — Updates intervention record status.
16. **Set cooldown** — Redis `SETEX cooldown:{store_id}:{customerId}` with policy TTL.
17. **Mark sent** — Redis `SET lock:sent:{sessionId}` (5 min TTL) prevents re-send.
18. **Metrics** — Records intervention counts, decision latency.

### Fast-Path Trigger Endpoint

1. **Receive** — `enrichment-session` sends `POST /v1/trigger` with `X-Internal-Secret` auth.
2. **Auth** — Fail-fast 401 if secret mismatches.
3. **Respond 202** — Response sent immediately; pipeline runs asynchronously.
4. **Freshen** — Refreshes mutable session state (`cart_value`, `is_frustrated`, `rage_click_count`) from Redis via `SessionFeaturesService`.
5. **Decide** — Calls `DecisionOrchestrator.decide()` with freshened event.

### Stale Scanner (Background Worker)

1. Every 5 minutes, acquires distributed lock (`scan:lock`, TTL 4 min).
2. Queries `active:sessions` sorted set for sessions with `last_activity` older than 2 minutes.
3. For each stale session, builds synthetic `idle_timeout` event with `session_available = false`.
4. Runs through orchestrator — rules engine routes to off-shop channels (email/SMS).

### Scheduler Worker (Background Worker)

1. Pops due session IDs from `eval:queue` sorted set (max 100 per tick).
2. For each session, reads context from Redis and evaluates through orchestrator.
3. Implements score-based backoff: 0.5–0.6 → 30 s, 0.3–0.5 → 2 min, 0.0–0.3 → 5 min.

## Configuration

Configuration is loaded from environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3007` | Health/trigger HTTP port |
| `KAFKA_HOSTS` | `kafka:29092` | Comma-separated Kafka bootstrap brokers |
| `KAFKA_TOPIC_ENRICHED` | `enriched.events` | Input topic |
| `KAFKA_TOPIC_INTERVENTION_LOG` | `intervention.log` | Intervention audit topic |
| `KAFKA_TOPIC_DLQ` | `dead.letters` | Dead-letter queue |
| `KAFKA_GROUP_ID` | `decision-group` | Consumer group ID |
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `POSTGRES_URL` | `postgresql://admin:password@pgbouncer:6432/app_db` | PostgreSQL connection |
| `CLICKHOUSE_URL` | `http://clickhouse:8123` | ClickHouse connection |
| `INTERNAL_SECRET` | `dev-internal-secret` | Shared secret for internal HTTP calls |
| `GATEWAY_URL` | `http://intervention-gateway:3005` | Intervention gateway base URL |
| `NOTIFICATION_URL` | `http://notification-service:3006` | Notification service base URL |
| `MODEL_PATH` | — | Absolute path to ONNX model file (omit to skip inference) |
| `LOG_LEVEL` | `info` | Tracing filter string |

## Dependencies

### Core Runtime

| Package | Purpose |
|---------|---------|
| `@org/kafka_client` | Kafka consumer/producer |
| `@org/redis_client` | Redis multiplexed client |
| `@org/db` | Drizzle ORM PostgreSQL client |
| `@org/clickhouse_client` | ClickHouse client |
| `@org/cache` | Multi-level cache (Redis + memory) |
| `@org/types` | Shared TypeScript types |
| `@org/logger` | Structured logging |
| `@org/monitoring` | Prometheus metrics |

### Inference

| Package | Purpose |
|---------|---------|
| `onnxruntime-node` | ONNX model runtime |

## Data Stores

### Redis

**Keys used:**

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `policy:store:{store_id}` | String | 300 s (5 min) | Cached store policy |
| `cooldown:{store_id}:{customerId}` | String | Policy cooldown window (default 3600 s) | Per-customer intervention cooldown |
| `budget:{store_id}:{date}` | String | 24 h | Daily budget reservation counter |
| `feature:{store_id}:{distinctId}` | String | 3600 s (1 h) | Cached ClickHouse features |
| `lock:intervention:{sessionId}` | String | 30 s | Session-level decision lock (heartbeat-renewed every 5 s) |
| `lock:cart:{cartId}` | String | 300 s (5 min) | Cart-level decision lock |
| `intervention:sent:{sessionId}` | String | 300 s (5 min) | Sent marker — prevents duplicate interventions |
| `risk:{sessionId}` | String | 60 s | Latest risk score for observability |
| `eval:queue` | Sorted Set | persistent | Delayed session re-evaluation queue |
| `active:sessions` | Sorted Set | auto-expire | Tracks active sessions for stale scanner |
| `scan:lock` | String | 240 s (4 min) | Distributed lock for stale scanner |
| `session:{sessionId}` | Hash | 1800 s (30 min) | Session state written by enrichment-session |

### PostgreSQL

**Tables used (via `@org/db`):**

| Table | Purpose |
|-------|---------|
| `policy_rules` | Store-level intervention policies |
| `discount_codes` | Generated discount codes (`CR-{store_id}-{random}`, 1 h TTL) |
| `interventions` | Intervention audit log |
| `customers` | Customer records (via shared package) |
| `customer_identities` | Identity mapping (via shared package) |
| `processed_events` | Idempotency (via shared package) |

### ClickHouse

**Materialized view:**

| View | Columns | Purpose |
|------|---------|---------|
| `mv_customer_features` | `store_id`, `distinct_id`, `abandonment_rate_7d`, `avg_cart_value_30d` | Batch features for risk scorer |

## Decision Pipeline

### Two-Phase Architecture

The `DecisionOrchestrator.decide()` method implements a strict two-phase pipeline:

**Phase 1 — Risk Scoring** determines *if* we should intervene.
**Phase 2 — Intervention Pipeline** determines *what* to do and executes delivery.

This separation ensures expensive operations (discount generation, outbound delivery) only run when risk is high enough.

### Risk Scoring Logic

```
Input: EnrichedEvent + CustomerFeatures + Policy
  │
  ├─▶ RuleEngine.evaluate() ──▶ deterministic score + type/channel/value
  │
  ├─▶ InferenceService.predict() ──▶ ONNX confidence (or null on timeout/error)
  │
  └─▶ Merge:
        if ONNX confidence > 0.6: use ONNX confidence
        else: use rule confidence
        type/channel/value always from rules
```

**Rule engine gates:**
- Cart value must exceed `policy.minCartValue` (default 10).
- If session unavailable (closed tab): email/SMS only, based on consent flags.
- If frustrated + high abandonment: `price_reduction` in-shop (confidence 0.85).
- If high abandonment only: `free_shipping` in-shop (confidence 0.7).
- If frustrated only: `countdown` in-shop (confidence 0.55).
- If cart value > 3× min: generic `popup` in-shop (confidence 0.45).

**ONNX inference:**
- Runs in parallel with rules.
- Overrides confidence only when `confidence > 0.6`.
- Falls back to rules on timeout (>50 ms) or error.
- Wrapped in a **cockatiel circuit breaker** (ConsecutiveBreaker): opens after 5 consecutive failures, resets after 5 minutes. When open, inference is skipped without attempting the call.

**ONNX input tensor** (shape `[1, 4]`, `float32`):
```
[0] abandonment_rate_7d         — 7-day cart abandonment rate for this customer (from ClickHouse)
[1] avg_cart_value_30d          — 30-day average cart value (from ClickHouse)
[2] SESSION_PAGE_DEPTH          — placeholder (0) — not yet computed by enrichment-session
[3] SESSION_TIME_ON_PAGE_S      — placeholder (0) — not yet computed by enrichment-session
```

Output: single `float32` confidence score, clamped to `[0, 1]`. Out-of-range values trigger a warning log.

### Intervention Pipeline Steps

1. **isSent guard** — Prevents duplicate sends within 5-minute window.
2. **Session lock** — Ensures only one decision per session at a time.
3. **Cart lock** — Prevents duplicate interventions across browser tabs sharing a cart.
4. **Budget gate** — Reserves `discountValue` from daily budget; skips if exhausted.
5. **Experiment** — Assigns variant for A/B tracking.
6. **Discount** — Generates unique code for monetary offers.
7. **Write** — Fire-and-forget audit record (does not block outbound delivery). Kafka DLQ on write failure.
8. **Outbound** — Delivers via gateway (in-shop) or notification-service (off-shop).
9. **Mark delivered** — Updates audit status.
10. **Cooldown** — Sets per-customer cooldown.
11. **Mark sent** — Prevents re-send.
12. **Metrics** — Records outcome.

## API Contract

### POST /v1/trigger (Fast Path)

Accepts trigger events directly from `enrichment-session` for sub-100ms latency.

**Headers:**
- `Content-Type: application/json`
- `X-Internal-Secret: <INTERNAL_SECRET>`

**Body:** `EnrichedEvent` JSON (same schema as Kafka).

**Response:** `202 Accepted` immediately; decision runs asynchronously.

**Auth:** Shared secret comparison; 401 on mismatch.

### POST /v1/internal/recalculate (Internal Admin)

Re-runs the full decision pipeline for a session using current Redis session state.

**Headers:** `X-Internal-Secret: <INTERNAL_SECRET>` — never exposed through Kong.

**Body:** `{ sessionId: string }`

**Response:** `200 { status: "ok", sessionId }` or `404` if session hash expired.

### POST /v1/internal/intervention/manual (Internal Admin)

Bypasses risk threshold and directly executes Phase 2 with admin-provided parameters.

**Headers:** `X-Internal-Secret: <INTERNAL_SECRET>` — never exposed through Kong.

**Body:** `{ sessionId, type, value, overrideCooldown? }`

**Response:** `200 { interventionId, status: "sent" }` or `202 { status: "skipped", reason }` or `404/422`.

### Health Endpoints

- **GET /live** — Always 200 if process is running.
- **GET /ready** — Returns 200 when Redis is reachable and Kafka consumer has subscribed. Returns 503 with JSON body `{ status: "not_ready", reason }` otherwise.
- **GET /metrics** — Prometheus metrics text format.

## Observability

### Metrics (Prometheus)

| Metric | Type | Description |
|--------|------|-------------|
| `decision_latency_ms` | Histogram | End-to-end orchestrator latency |
| `intervention_total` | Counter | Interventions emitted, tagged `type`, `channel`, `variant` |
| `outbound_push_ms` | Histogram | Outbound delivery latency, tagged `channel` |
| `onnx_inference_ms` | Histogram | ONNX inference duration |
| `db_operation_ms` | Histogram | PostgreSQL/ClickHouse query latency, tagged `db`, `operation` |
| `decision_kafka_lag` | Gauge | Consumer lag per partition |
| `decision_cooldown_hit_total` | Counter | Sessions skipped due to active cooldown |
| `decision_budget_exhausted_total` | Counter | Interventions skipped due to depleted budget |
| `risk_score_distribution` | Histogram | Risk score values observed per decision |
| `lock_acquire_failed_total` | Counter | Redis lock acquisition failures (fail-open), tagged `type` (`session`/`cart`) |
| `onnx_fallback_total` | Counter | ONNX inference failures (model loaded, inference failed/timed out) |
| `decision_degraded_features_total` | Counter | Decisions that used zero features due to ClickHouse/cache failure |
| `onnx_circuit_state_total` | Counter | ONNX circuit breaker state transitions, tagged `state` (`open`/`closed`) |

## Graceful Shutdown

On SIGTERM/SIGINT:
1. Stops stale scanner and scheduler workers.
2. Shuts down Kafka consumer and producer.
3. Stops health server.
4. Exits process.

## Error Handling

| Failure | Handling |
|---------|----------|
| Invalid JSON | → DLQ, continue batch |
| Redis/PostgreSQL/ClickHouse error | Fail-open or return safe defaults (zero features, null policy) |
| ONNX inference timeout/error | Log + fallback to rules; `onnx_fallback_total` incremented |
| Orchestrator unexpected error | Caught and logged; never throws to consumer |
| Outbound delivery failure | Logged; intervention still recorded as delivered=false in DB |
| Lock acquisition failure | Skip decision for this event; another instance will handle it |
| Budget exhausted | Skip intervention; `budget_exhausted_total` incremented |

## Retry Strategy

- **Decision retries:** 3 attempts with exponential backoff (100 ms, 200 ms, 400 ms).
- **Backoff on decision failure:** 5-second pause with `state.backingOff = true`.
- **DLQ routing:** Events that exhaust retries go to `kafkaTopicDlq`.

## Deployment

### Kafka Consumer Configuration

- **Group ID:** `decision-group`
- **Rebalancing:** `useCooperativeRebalancing: true` (`CooperativeStickyAssignor`)
- **Auto-commit:** Disabled (manual commits after batch).
- **Session timeout:** 30 s
- **Heartbeat interval:** 3 s
- **Max in-flight requests:** 1

### ONNX Model

- Loaded from filesystem path specified by `MODEL_PATH`.
- Version controlled via container image rollout.
- If `MODEL_PATH` is unset, inference is skipped and only rules are used.

### Nx Integration

Standard Node.js Nx targets (`build`, `test`, `lint`, `run`).

## Testing

Unit-testable components:
- `RuleEngine` — pure function, no I/O.
- `RiskScorerService` — orchestrates rules + inference with mocked dependencies.
- `SessionFeaturesService` — Redis integration tests.
- `TriggerHandler` — unit tests for auth and session freshening.
- `OutboundService` — unit tests with mocked fetch.

Run tests via:
```bash
nx test decision-engine