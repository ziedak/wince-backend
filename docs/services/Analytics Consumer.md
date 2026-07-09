Analytics Consumer — Detailed Service Explanation

The Analytics Consumer is a critical microservice in your architecture that bridges the real‑time event pipeline and the analytics data warehouse. It consumes enriched events from Kafka and writes them to ClickHouse, enabling dashboards, reporting, and model training.

Let me give you the full picture.
1. Why Do You Need an Analytics Consumer?

Your system has two distinct data consumers:
Consumer	Purpose	Latency	Data Volume
Decision Engine	Real‑time interventions	< 200ms	Only trigger events (5‑10% of total)
Analytics Consumer	Long‑term analytics & ML	Seconds to minutes	100% of enriched events

Without a dedicated Analytics Consumer:

    Your ClickHouse would be written directly from Enrichment Service (tight coupling)

    ClickHouse outages would block the enrichment pipeline

    You'd lose the ability to replay historical events for backfilling

    Dashboards would impact the real‑time critical path

The Analytics Consumer solves this by:

    Decoupling ClickHouse writes from the hot path

    Allowing batch inserts (10k rows at a time) for efficiency

    Providing a single point of failure for analytics (not the whole pipeline)

    Enabling replay from Kafka offsets if ClickHouse needs to be rebuilt

2. Architecture Overview

graph TD
    A[Kafka: enriched.events] --> B[Analytics Consumer]
    B --> C[Batch Buffer]
    C --> D[ClickHouse]
    B --> E[Prometheus Metrics]
    B --> F[Dead Letter Queue]

3. Detailed Responsibilities
3.1 Kafka Consumer

    Input Topic: enriched.events

    Consumer Group: analytics-consumer-group (KAFKA_GROUP_ID)

    Partitions: 64 (must match the topic)

    Auto‑commit: Disabled (manual commit via commitOffsetsIfNecessary after ClickHouse insert)

    Batch size: 10,000 rows (BATCH_SIZE) — KafkaJS's eachBatch delivers whatever the broker returns per fetch; there is no separate "max poll records" knob like a native Kafka consumer. Rows are accumulated across eachBatch calls into an in-process buffer and flushed at the configured size/time threshold, independent of how many messages KafkaJS hands over per call.

Why manual commit? To guarantee at‑least‑once semantics. Offsets are committed only after the batch is successfully inserted into ClickHouse (or routed to the DLQ on permanent failure).
3.2 Batch Buffer

Events are accumulated in memory until:

    Size threshold: 10,000 events

    Time threshold: 5 seconds (whichever comes first)

Implementation:
typescript

let buffer: ClickHouseEvent[] = [];
let flushTimer: NodeJS.Timeout;

async function addEvent(event: ClickHouseEvent) {
  buffer.push(event);
  if (buffer.length >= BATCH_SIZE) flushBuffer();
}

async function flushBuffer() {
  if (buffer.length === 0) return;
  await insertIntoClickHouse(buffer);
  buffer = [];
}

3.3 ClickHouse Writer

    Insert Method: HTTP /v1/insert?format=JSONEachRow

    Table: events (defined schema)

    Retry: 3 attempts, exponential backoff (100ms, 200ms, 400ms)

    Failure Handling: On persistent failure → send to DLQ

ClickHouse Insert Payload (canonical field names — renamed from the original draft below; `customer_email` was dropped entirely, never written to ClickHouse, per PII policy docs/domains/security.md:81):
json

{
  "timestamp": 1749283200000,
  "eid": "evt_9f3...",
  "t": "add_to_cart",
  "sid": "abc-123",
  "anon": "user-456",
  "store_id": 1,
  "customer_id": null,
  "cart_value": 89.99,
  "lifetime_value": 0,
  "email_consent": 0,
  "sms_consent": 0,
  "rage_click_count": 0,
  "is_frustrated": 0,
  "session_available": 1,
  "properties": "{\"product_id\": 123, \"quantity\": 2}",
  "server_timestamp": 1749283201000
}

3.4 Transform Logic

The enriched event from Kafka is mapped to ClickHouse schema (see apps/analytics-consumer/src/types.ts::toClickHouseRow — field names below are already flat on EnrichedEvent, not prefixed with `session_`, and `customer_email`/email is never read into the ClickHouse row):
typescript

function toClickHouseRow(event: KafkaEnrichedEvent): ClickHouseRow {
  return {
    timestamp: event.ts,
    eid: event.eid,
    t: event.t,
    sid: event.sid,
    anon: event.anon,
    store_id: event.store_id,
    customer_id: event.customer_id ?? null,
    cart_value: event.cart_value ?? 0,
    lifetime_value: event.lifetime_value ?? 0,
    email_consent: event.email_consent ? 1 : 0,
    sms_consent: event.sms_consent ? 1 : 0,
    rage_click_count: event.rage_click_count ?? 0,
    is_frustrated: event.is_frustrated ? 1 : 0,
    session_available: event.session_available ? 1 : 0,
    properties: JSON.stringify(event.props ?? {}),
    server_timestamp: new Date().toISOString(),
  };
}

3.5 Dead Letter Queue (DLQ)

If ClickHouse insert fails after all retries:

    Write the original Kafka message to dead.letters topic (KAFKA_DLQ_TOPIC — the shared DLQ topic also used by decision-engine, provisioned by init-kafka).

    Commit the Kafka offset (skip the message) to avoid blocking the consumer.

    Increment analytics_consumer_dlq_total metric (labeled by reason: parse_error, duplicate-skip is not DLQ'd, batch_insert_failed, intervention_batch_insert_failed).

    Alert if DLQ rate > 1%.

DLQ Schema:
json

{
  "reason": "batch_insert_failed",
  "original": "...",
  "original_topic": "enriched.events",
  "original_partition": 3,
  "original_offset": "12345",
  "service": "analytics-consumer",
  "timestamp": "2025-07-06T10:00:00Z"
}

3.6 Idempotency

Because ClickHouse is append‑only and Kafka provides at‑least‑once delivery, duplicates are possible (rare). Status: Option B is implemented (not just planned) — a Redis bloom filter (ENABLE_DEDUP=true, BLOOM_FILTER_KEY) is checked before buffering each event and populated after a successful ClickHouse flush (`redis.bfAdd`/`bfExists`). If Redis is unavailable, dedup checks fail open (event is processed, not dropped) rather than blocking the pipeline.
4. Data Schema in ClickHouse

See packages/db/src/schema/clickhouse/events.sql for the canonical, applied DDL (reproduced below — note `customer_email` is intentionally absent, and the table is sharded via `events_local` + a `Distributed` `events` table, not a single non-replicated table):
sql

CREATE TABLE events_local ON CLUSTER default_cluster
(
    timestamp          DateTime64(3) CODEC(Delta, ZSTD),
    eid                String        CODEC(ZSTD),
    t                  LowCardinality(String),
    sid                String,
    anon               String,
    store_id           UInt32,
    customer_id        Nullable(UInt32),
    cart_value         Float64,
    lifetime_value     Float64,
    email_consent      UInt8,
    sms_consent        UInt8,
    rage_click_count   UInt8,
    is_frustrated      UInt8,
    session_available  UInt8,
    properties         JSON,
    server_timestamp   DateTime64(3) DEFAULT now64()
) ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/events_local', '{replica}')
PARTITION BY toYYYYMM(timestamp)
ORDER BY (store_id, t, timestamp)
TTL timestamp + INTERVAL 90 DAY;

CREATE TABLE events ON CLUSTER default_cluster
AS events_local
ENGINE = Distributed(default_cluster, default, events_local, rand());

A parallel `intervention_events` ClickHouse table (+ Postgres mirror) also exists for `$intervention_shown/clicked/dismissed/accepted/...` lifecycle events — see §3.7 below; this was added after this document was originally written.

4.1 Query Patterns

The Admin API queries ClickHouse for:

    Recovery rate over time: SELECT date, recovery_rate FROM daily_abandonment_stats WHERE store_id = ?

    Hourly abandonment heatmap: SELECT hour, COUNT(*) FROM events WHERE t = 'checkout_abandon' GROUP BY hour

Revenue recovered by intervention is NOT queried from ClickHouse — `/admin/analytics/revenue` queries the PostgreSQL `interventions` table instead (it already has `type`, `converted`, `revenueAttributed` columns; ClickHouse's `events`/`intervention_events` tables have no such columns).

5. Metrics & Observability
Prometheus Metrics
Metric	Type	Labels	Description
analytics_consumer_events_total	Counter	status (success, duplicate, parse_error, dlq)	Events read from Kafka
analytics_consumer_rows_inserted_total	Counter	–	Rows successfully inserted into ClickHouse
analytics_consumer_batch_size_rows	Histogram	–	Number of rows per flushed batch
analytics_consumer_batch_insert_latency_ms	Histogram	–	Time to insert a batch into ClickHouse, in milliseconds (not seconds)
analytics_consumer_lag_messages	Gauge	topic, partition	Current lag per topic-partition
analytics_consumer_dlq_total	Counter	reason	Events sent to the DLQ topic
analytics_batch_flush_failure_total	Counter	table	Failed batch insert attempts (events or intervention_events)
analytics_consumer_intervention_events_total	Counter	–	$intervention_* rows inserted into ClickHouse
analytics_consumer_intervention_events_dropped_total	Counter	reason	$intervention_* events dropped (e.g. missing intervention_id)
analytics_consumer_intervention_pg_insert_failures_total	Counter	–	Non-fatal PostgreSQL mirror insert failures
analytics_consumer_reconciliation_delta_rows / _ratio	Gauge	–	Kafka-consumed-vs-ClickHouse-persisted row delta (see §3.7)
analytics_consumer_reconciliation_mismatch_total	Counter	–	Incremented when the reconciliation delta exceeds tolerance
Alerts

    analytics_consumer_lag_messages > 5000 for 5 minutes → Warning (scale consumer)

    analytics_consumer_dlq_total > 10 per minute → Critical (ClickHouse down)

    analytics_consumer_events_total{status="parse_error"} > 100 per minute → Critical

    analytics_consumer_reconciliation_mismatch_total increasing → Critical (silent data loss)

Note: these alert rules are not yet codified as Prometheus alerting rules/K8s manifests anywhere in this repo — they exist only as documentation intent here.

6. Configuration
Environment Variable	Default	Description
KAFKA_HOSTS	kafka:29092	Kafka bootstrap servers (comma-separated)
KAFKA_TOPIC	enriched.events	Input topic
KAFKA_GROUP_ID	analytics-consumer-group	Consumer group ID
KAFKA_DLQ_TOPIC	dead.letters	Shared DLQ topic (also used by decision-engine)
KAFKA_CLIENT_ID	analytics-consumer	Kafka client ID
KAFKA_ADMIN_CLIENT_ID	analytics-consumer-admin	Kafka admin client ID (lag polling)
CLICKHOUSE_URL	http://clickhouse:8123	ClickHouse HTTP endpoint
CLICKHOUSE_DATABASE	default	Database name
CLICKHOUSE_TABLE	events	Table name
CLICKHOUSE_INTERVENTION_EVENTS_TABLE	intervention_events	$intervention_* lifecycle table
POSTGRES_URL	postgresql://admin:password@pgbouncer:6432/app_db	Postgres mirror for intervention lifecycle events
BATCH_SIZE	10000	Max rows per batch
BATCH_TIMEOUT_MS	5000	Max time before flushing batch
ENABLE_DEDUP	false	Enable Redis bloom-filter dedup
REDIS_URL	redis://localhost:6379	Redis connection (dedup)
BLOOM_FILTER_KEY	analytics:dedup	Redis bloom filter key
MAX_RETRIES	3	ClickHouse insert retry attempts
RETRY_BASE_DELAY_MS	100	Exponential backoff base (100/200/400ms)
PORT	3009	HTTP health/metrics port
LAG_POLL_INTERVAL_MS	30000	Consumer group lag poll interval
RECONCILIATION_INTERVAL_MS	300000	Kafka-vs-ClickHouse reconciliation check interval
RECONCILIATION_TOLERANCE_RATIO	0.01	Acceptable row-count delta ratio before alerting
LOG_LEVEL	info	Log level
7. Deployment
Dockerfile (see apps/analytics-consumer/Dockerfile — esbuild output isn't bundled, so the runtime image installs from a pruned package.json + workspace_modules rather than copying node_modules directly)
dockerfile

FROM oven/bun:1.0.25 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bunx nx run @org/analytics-consumer:prune

FROM oven/bun:1.0.25-slim
WORKDIR /app
COPY --from=build /app/apps/analytics-consumer/dist ./
RUN bun install --production

EXPOSE 3009
CMD ["bun", "main.js"]

This service is now included in the local docker-compose.yml stack (it previously had neither a Dockerfile nor a compose entry).

Kubernetes Deployment
yaml

apiVersion: apps/v1
kind: Deployment
metadata:
  name: analytics-consumer
spec:
  replicas: 2
  selector:
    matchLabels:
      app: analytics-consumer
  template:
    metadata:
      labels:
        app: analytics-consumer
    spec:
      containers:
      - name: consumer
        image: analytics-consumer:latest
        env:
        - name: KAFKA_HOSTS
          value: "kafka:29092"
        - name: CLICKHOUSE_URL
          value: "http://clickhouse:8123"
        resources:
          limits:
            cpu: 1
            memory: 2Gi
          requests:
            cpu: 500m
            memory: 1Gi
        livenessProbe:
          httpGet:
            path: /live
            port: 3009
        readinessProbe:
          httpGet:
            path: /ready
            port: 3009
---
apiVersion: v1
kind: Service
metadata:
  name: analytics-consumer
spec:
  selector:
    app: analytics-consumer
  ports:
    - port: 3009

KEDA Scaler (Auto‑Scale on Lag)
yaml

apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: analytics-consumer-scaler
spec:
  scaleTargetRef:
    name: analytics-consumer
  triggers:
  - type: kafka
    metadata:
      bootstrapServers: kafka:29092
      consumerGroup: analytics-consumer-group
      topic: enriched.events
      lagThreshold: "1000"

8. Interaction with Other Services
Service	Interaction
Kafka	Consumes enriched.events; produces to dead.letters (DLQ) on permanent failure
ClickHouse	Writes batched events + intervention_events rows
PostgreSQL\tBest-effort mirror of $intervention_* lifecycle events into the intervention_events table (added after this doc's original scope; never blocks the ClickHouse write path or offset commit)
Redis	Optional bloom-filter dedup (ENABLE_DEDUP)
Admin API	Reads from ClickHouse (recovery/heatmap dashboards) and PostgreSQL interventions (revenue-by-intervention dashboard)
Decision Engine	No direct interaction (decoupled via Kafka)
Reconciliation	Implemented as an in-process periodic check inside this service (§3.7 / config RECONCILIATION_INTERVAL_MS), not a standalone "Reconciliation Worker" service as originally envisioned here — it compares rows this process has flushed since start() against a live ClickHouse count for the same window and emits analytics_consumer_reconciliation_* metrics on mismatch. A cross-restart, cross-instance, or offset-vs-retention-aware reconciliation would still require a separate standalone worker; that has not been built.
9. Error Handling Summary
Failure	Action
ClickHouse insert timeout (5s)	Retry 3 times with backoff (100, 200, 400ms)
ClickHouse permanent error (schema mismatch)	Send to DLQ, commit offset
Kafka consumer error	Retry with backoff; if persistent, restart pod
Redis (if dedup enabled)	If Redis unavailable, proceed without dedup (log)
PostgreSQL intervention mirror insert failure	Logged and skipped (non-fatal) — ClickHouse remains the reporting source of truth
10. Scalability

    Replicas: 1–3 (start with 1; scale on lag)

    Partitions: 64 (match enriched.events)

    Consumer group: Multiple consumers can run, but each partition is assigned to one consumer.

    Lag alert: If lag > 1000, scale replicas (KEDA).

11. Summary (Why It Exists)

    The Analytics Consumer is the only service that writes to ClickHouse. It decouples the real‑time pipeline from the analytics warehouse, ensures efficient batch inserts, handles failures gracefully, and provides the data for dashboards, reporting, and model training. It is a simple but critical component that allows the Decision Engine to stay fast and focused on interventions.

