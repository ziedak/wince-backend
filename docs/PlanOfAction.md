This plan reflects all final decisions from the architecture review and the authentication redesign. No Kubernetes or Terraform for development – Docker Compose only until staging.
Phase 0: Foundation – Local Development Environment (Week 1)
0.1 Prerequisites Done

    Install Docker Desktop, Node.js 20, Rust (if writing Ingestion in Rust), bun.

    Clone repository: git clone ...

0.2 Docker Compose for Dependencies done

Create docker-compose.yml with:

    Kafka + Zookeeper (single broker, create 64 partitions for raw.events and enriched.events via script)

    PostgreSQL 14 + PgBouncer

    Redis + RedisBloom (for Bloom filter)

    ClickHouse (single node)

    Kong JWT auth for admin routes

    (Optional) S3 mock (MinIO)

Run: docker-compose up -d
0.3 Shared Libraries (TypeScript + Rust crates)

Create packages:

    @wince/logger (pino with trace ID)

    @wince/kafka-client (KafkaJS wrapper, idempotent producer)

    @wince/redis-client (ioredis + Bloom filter commands)

    @wince/types (shared TypeScript interfaces)

    Rust workspace for ingestion service (shared Kafka producer, schema validation)

0.4 Database Schemas

    Run PostgreSQL DDL (tables from spec).

    Run ClickHouse DDL (events table, materialized view).

    Redis: reserve Bloom filter BF.RESERVE idem:bloom 0.001 6000000000.

Phase 1: Ingestion & Raw Event Pipeline (Week 2)
1.1 API Gateway (Kong) – Dev Mode

Run Kong via Docker Compose (or a simple HTTP proxy for dev). Configure routes:

    POST /v1/track → http://host.docker.internal:3001 (Ingestion Service)

    POST /v1/admin/* → http://host.docker.internal:3008 (Admin API)

    GET /ws → http://host.docker.internal:3005 (Intervention Gateway)

Auth for dev: bypass or mock (e.g., accept dummy API key).
1.2 Ingestion Service (Rust) Done

    Endpoint POST /v1/track.

    Validate API key via a simple local map (for dev) – replace with Kong key-auth / API Key Service later.

    Validate JSON schema (use jsonschema).

    Sanitise PII.

    Produce to Kafka raw.events (key = session_id).

    Return 202.

Run: cargo run (hot reload with cargo watch).
1.3 API Key Service (Node.js) – Dev Mock

    Simple endpoint GET /internal/api-key/lookup?key=test → return {store_id: 1, rate_limit: 1000}.

    Later replace with real PostgreSQL + Redis.

1.4 Kafka Topics Creation Script

    Use kafka-topics --create (or Confluent CLI) to create these topics with the correct partitions:

    raw.events (64 partitions, key=session_id)
    enriched.events (64 partitions, key=session_id)
    intervention.log (16 partitions, key=session_id)
    notification.log (16 partitions, key=session_id)
    dead.letters (8 partitions, key=session_id)
    audit.log (8 partitions, key=store_id)

    Example:

    kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic raw.events --partitions 64 --replication-factor 1
    kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic enriched.events --partitions 64 --replication-factor 1
    kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic intervention.log --partitions 16 --replication-factor 1
    kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic notification.log --partitions 16 --replication-factor 1
    kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic dead.letters --partitions 8 --replication-factor 1
    kafka-topics --bootstrap-server kafka:29092 --create --if-not-exists --topic audit.log --partitions 8 --replication-factor 1

1.5 Analytics Consumer (Node.js)

       Analytics Consumer (Node.js)

        Kafka consumer for enriched.events (group analytics-group, manual commits, cooperative rebalancing).

        Batch events (10k rows / 5s) and insert into ClickHouse via HTTP JSONEachRow.

        Transform event schema to ClickHouse events table.

        Exponential backoff retry (3 attempts) on ClickHouse failures; permanent errors to dead.letters.

        Export Prometheus metrics (consumed events, batch size, latency, lag).

        Health endpoints /live, /ready.

        Graceful shutdown (SIGTERM) with final offset commit.

        Configuration via environment variables.

        Unit and integration tests.

Run: bun dev:analytics-consumer
Phase 2: Enrichment & Session (Week 3)
2.1 Enrichment & Session Service (Node.js) Done
Phase 2: Enrichment & Session Service (Week 3) – Complete Detailed Plan
2.1 Service Architecture
Aspect	Specification
Language	Node.js 20+ (TypeScript)
Runtime	Bun (for dev), Node.js (for production)
Kafka consumer group	enrichment-group
Topics	Consumes raw.events (64 partitions). Produces enriched.events (64 partitions).
Cooperative rebalancing	Yes – use CooperativeStickyAssignor
Idempotency	Redis Bloom filter (idem:bloom) + PostgreSQL processed_events table (fallback)
Concurrency	Process events in batches, max 500 per poll
Offset commit	Manual commit after successful batch processing (at‑least‑once semantics)
2.2 Missing Details to Add
🔴 Kafka Consumer Configuration (not specified)
typescript

// consumer options
{
  groupId: 'enrichment-group',
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
  maxPollInterval: 300000,
  maxPollRecords: 500,
  autoCommit: false,
  partitionAssignmentStrategy: 'CooperativeStickyAssignor'
}

🔴 Error Handling & Dead Letter Queue
Scenario	Action
Transient DB failure (PostgreSQL/Redis timeout)	Retry processing up to 3 times with exponential backoff (100ms, 200ms, 400ms). If still failing, pause consumer for 5 seconds, then resume.
Permanent failure (invalid schema, malformed data)	Write original event to Kafka dead.letters topic, then commit offset (skip). Do not block the partition.
Kafka produce error (cannot write to enriched.events)	Retry 3 times with backoff. If still fails, write to dead.letters. Do not commit offset.
Redis outage (cannot read/write session)	Log error, degrade gracefully – still produce enriched event without session data, but mark session_available: false.
🔴 Idempotency Implementation Details

    Redis Bloom filter – already reserved with BF.RESERVE idem:bloom 0.001 6000000000.

    Deduplication logic:

        Check event_id in Bloom filter.

        If not present → process event.

        If present (possible false positive), query PostgreSQL processed_events table for exact match.

        If duplicate → skip processing and commit offset.

        If not duplicate → process and add to Bloom filter.

    Bloom filter management:

        Periodically recreate the filter when size limit approaches (use BF.INFO to monitor).

        Store a timestamp of last rebuild; have a fallback mechanism.

🔴 Session State Management – Detailed
Key Pattern	Data Structure	TTL	Update Rules
session:{session_id}	Hash	30 min (renewed on each event)	Fields: cart_value (incremental), rage_click_count (incremental), last_activity (timestamp), items (JSON array, optional).
Sliding window for rage clicks	Keep array of timestamps (max 10) in session hash.	-	On rage_click event, append timestamp; remove older than 30 seconds. Count length for is_frustrated.
🔴 PostgreSQL Queries & Caching

    Customer lookup: SELECT id, email, lifetime_value, email_consent, sms_consent FROM customers WHERE store_id = $1 AND distinct_id = $2.

    Cache in Redis: key cache:customer:{store_id}:{distinct_id} with TTL 5 minutes.

    Create new anonymous customer on first visit (if not found):
    sql

INSERT INTO customers (store_id, distinct_id, created_at)
VALUES ($1, $2, NOW())
ON CONFLICT (store_id, distinct_id) DO NOTHING
RETURNING id;

🔴 Batch Processing & Commit Strategy

    Read up to 500 events from Kafka.

    Process each event in sequence (to preserve order per partition).

    Accumulate all successful events into a processedOffsets set.

    After the batch is fully processed (or after a timeout of 5 seconds), commit the highest offset of the batch.

    If any event fails permanently (moved to DLQ), commit offset anyway (skip). If transient failure, do not commit.

🔴 Observability & Metrics

Export to Prometheus:
Metric	Type	Labels
enrichment_events_processed_total	Counter	status (success/dropped/deduplicated)
enrichment_processing_latency_seconds	Histogram	–
enrichment_db_query_latency_seconds	Histogram	operation (customer_lookup, session_update)
enrichment_kafka_lag	Gauge	partition
enrichment_redis_bloom_false_positive	Counter	–
🔴 Health Checks & Kubernetes Probes

    Liveness probe (HTTP /live): returns 200 if the process is running.

    Readiness probe (HTTP /ready): returns 200 only when:

        Kafka consumer has successfully subscribed and joined the group.

        PostgreSQL and Redis connections are alive.

        The service is not in a backoff/paused state.

🔴 Graceful Shutdown

    Listen for SIGTERM (Kubernetes) and SIGINT (local).

    Pause Kafka consumer (stop fetching new messages).

    Wait for current batch to finish processing (timeout 30 seconds).

    Commit final offsets.

    Close database connections and Redis client.

    Exit.

🔴 Configuration Environment Variables
env

KAFKA_BROKERS=kafka:29092
KAFKA_RAW_TOPIC=raw.events
KAFKA_ENRICHED_TOPIC=enriched.events
KAFKA_CONSUMER_GROUP=enrichment-group
REDIS_URL=redis://redis:6379
POSTGRES_PGBOUNCER=postgres://admin:password@pgbouncer:6432/app_db
BLOOM_FILTER_KEY=idem:bloom
SESSION_TTL_SECONDS=1800
MAX_POLL_RECORDS=500
COMMIT_INTERVAL_MS=5000

🔴 Testing Strategy
Test Type	Scope
Unit tests	Session update logic, idempotency check, customer lookup formatting.
Integration tests	Local Kafka + PostgreSQL + Redis (using Docker Compose). Send an event, verify it lands in enriched.events and session state is updated.
End‑to‑end	Full pipeline: tracker → ingestion → enrichment → ClickHouse.
Chaos	Kill Redis during processing – verify service continues (degraded), recovers after restart.
🔴 Deployment (Non‑Kubernetes for Dev)

    Development: bun dev:enrichment (uses .env for configuration).

    Production (Docker): Use Dockerfile that runs node dist/main.js. Set replicas=3, resource limits=2 CPU / 4 GiB, HPA based on Kafka lag.

Revised Phase 2 Plan – What to Add to Your Document

Replace your existing 2.1, 2.2, 2.3 with the following expanded checklist:
2.1 Enrichment & Session Service – Complete Implementation Checklist

    Kafka consumer setup with cooperative rebalancing, manual commit, 500 max poll records.

    Idempotency using Redis Bloom filter + PostgreSQL fallback.

    Customer lookup with Redis cache (TTL 5m) and anonymous creation.

    Session state in Redis Hash, TTL 30m, storing cart_value, rage_click_count, last_activity.

    Sliding window for rage clicks (store timestamps, recompute on each event).

    Error handling with retries (3 attempts, exponential backoff) and dead letter queue.

    Batch offset commit after successful processing of each batch (or every 5 seconds).

    Prometheus metrics (processed events, latency, Kafka lag, Bloom false positives).

    Health checks (/live, /ready) for Kubernetes.

    Graceful shutdown (SIGTERM) – pause consumer, finish current batch, commit offsets, close connections.

    Configuration via environment variables.

    Unit and integration tests (with testcontainers for Kafka/Redis/Postgres).

    Dockerfile for production.

    Kubernetes Deployment (replicas: 3, HPA based on lag).

2.2 Redis Session State – Implementation Details

    Use Redis Hash commands: HSET, HINCRBY, HGETALL, HEXPIRE.

    On add_to_cart: HINCRBY session:{id} cart_value <amount>.

    On rage_click: HINCRBY session:{id} rage_click_count 1.

    Update last_activity on every event.

    For sliding window: maintain a Redis List of timestamps, LPUSH, LTRIM, LLEN after filtering by age.

2.3 PgBouncer Integration

    Already defined in docker-compose.yml. Use port 6432.

    Configure connection pool size: pool_size=50 in PgBouncer config.

    Ensure all Node.js services use the PgBouncer endpoint (not direct PostgreSQL).

Phase 3: Decision Engine & Intervention (Week 4‑5)
3.1 Decision Engine (Node.js + embedded ONNX)

    Consumer of enriched.events filtered for abandonment types.

    Policy engine (cooldown, budget) using Redis + PostgreSQL.

    Feature fetching: real‑time from event, batch features from ClickHouse (via Redis cache).

    Embedded ONNX Runtime:

        Download model from S3 (for dev, place model.onnx locally).

        Load at startup.

        Run inference with 50ms timeout; concurrently compute rule‑based.

    Generate discount codes (store in PostgreSQL).

    Call Intervention Gateway (HTTP) and fallback to Notification Service.

    Log to intervention.log (Kafka) and PostgreSQL.

Run: bun dev:decision
3.2 Intervention Gateway (uWebSockets)

    WebSocket server.

    Connection registration in Redis ws:active (TTL 60s, renewed on heartbeat).

    HTTP push endpoint /v1/push:

        Look up Redis, forward to correct pod (in dev, single pod, no forwarding).

        Wait for client ACK.

    Graceful shutdown cleanup.

Run: bun dev:gateway
3.3 Notification Service (Node.js)

    HTTP endpoint /v1/notify.

    Check consent (dev: mock).

    Send email via SendGrid test API (or fake SMTP).

    Log to notification.log.

Run: bun dev:notification
3.4 Tracker SDK (JavaScript) – Simple Test Client

    HTML page with embedded tracker script.

    Simulate add_to_cart, checkout_abandon.

    Establish WebSocket connection to local gateway.

    Display received interventions.

Test end‑to‑end: Add to cart → abandon → receive popup.
Phase 4: Admin & Observability (Week 6)
4.1 Admin API (NestJS)

    Endpoints for store management, analytics, policies, experiments.

    Auth: In dev, bypass JWT (or use a fixed header). In staging/prod, Kong validates JWT issued by the Admin API login flow.

    Query ClickHouse for analytics.

Run: bun dev:admin-api
4.2 Kong Admin JWT Flow (Dev Mode)

    Implement POST /v1/admin/login in Admin API.

    Configure Kong JWT validation for admin routes in docker-compose.

4.3 A/B Testing Framework

    Add experiments table to PostgreSQL.

    Implement variant routing in Decision Engine.

    Expose experiment endpoints in Admin API.

4.4 Monitoring Stack (Prometheus + Grafana)

    Export metrics from all services (using prom-client or OpenTelemetry).

    Run Prometheus and Grafana in Docker Compose.

    Import dashboards for Kafka lag, event rates, prediction latency.

4.5 Reconciliation Worker (Cron)

    Compare Prometheus counters (ingestion accepted vs ClickHouse written).

    Check for undelivered interventions >1h.

Phase 5: Integration Testing & Load Testing (Week 7)
5.1 End‑to‑End Test Suite (Jest / Rust)

    Simulate complete user journey using real HTTP calls to Ingestion Service and WebSocket client.

    Verify events land in ClickHouse, intervention delivered, discount code generated.

5.2 Load Testing (k6)

    Script to send 10k events/sec (mix of page views, add_to_cart, checkout_abandon).

    Measure p99 intervention latency.

    Verify autoscaling (KEDA for Kafka consumers – in Docker Compose we can simulate with manual scaling).

5.3 Chaos Testing (Locally)

    Kill Redis container → verify budget counters still correct (PostgreSQL fallback).

    Kill Kafka broker → Ingestion Service retries and writes to dead.letters.

Phase 6: Production Readiness (Week 8) – Cloud & Kubernetes

Now, and only now, introduce Terraform and Kubernetes.
6.1 Terraform (AWS/GCP)

    Provision managed services: RDS (PostgreSQL), ElastiCache (Redis with RedisBloom), Confluent Cloud Kafka, ClickHouse Cloud, S3.

    EKS cluster (or GKE) with node groups.

6.2 Containerize All Services

    Write Dockerfiles for each service.

    Push to ECR/GCR.

6.3 Kubernetes Manifests / Helm Charts

    Deploy services with HPA (CPU/lag based), KEDA for Kafka consumers.

    Configure Kong Ingress with JWT validation for admin routes.

    Set up PgBouncer as a sidecar or separate deployment.

6.4 Staging Environment

    Deploy everything to a staging namespace.

    Run integration tests against staging.

6.5 Production Deployment

    Blue‑green or rolling update.

    Enable full monitoring and alerting.

Summary of Tools by Phase
Phase	Tools
Dev (Phases 0‑5)	Docker Compose, Node.js (ts-node/watch), Rust (cargo-watch), Kafka, Postgres, Redis, ClickHouse, Kong JWT auth, Prometheus, Grafana, k6.
Staging/Prod (Phase 6)	Terraform, Kubernetes (EKS/GKE), Helm, ArgoCD, managed databases, Confluent Cloud.