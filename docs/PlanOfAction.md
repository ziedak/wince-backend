This plan reflects all final decisions from the architecture review and the authentication redesign. No Kubernetes or Terraform for development – Docker Compose only until staging.
Phase 0: Foundation – Local Development Environment (Week 1)
0.1 Prerequisites Done

    Install Docker Desktop, Node.js 20, Rust (if writing Ingestion in Rust), pnpm.

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
1.2 Ingestion Service (Rust)

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

    Use kafka-topics --create (or Confluent CLI) to create all topics with correct partitions.

1.5 Analytics Consumer (Node.js)

    Consume enriched.events (first it will be empty; we will produce later).

    Batch insert into ClickHouse.

Run: pnpm dev:analytics-consumer
Phase 2: Enrichment & Session (Week 3)
2.1 Enrichment & Session Service (Node.js)

    Kafka consumer for raw.events (group enrichment-group, 64 partitions, cooperative rebalancing).

    Per event:

        Lookup customer (PostgreSQL, cache in Redis).

        Update session state (Redis Hash session:{session_id}).

        Produce enriched event to enriched.events.

    Idempotency: check Redis Bloom filter; on false positive, check PostgreSQL processed_events.

Run: pnpm dev:enrichment
2.2 Redis Session State

    Implement TTL (30 min), update on every event.

    Store: cart_value, rage_click_count, last_activity.

2.3 PgBouncer Integration

    Connect all Node.js services through PgBouncer on port 6432 (already in docker-compose).

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

Run: pnpm dev:decision
3.2 Intervention Gateway (uWebSockets)

    WebSocket server.

    Connection registration in Redis ws:active (TTL 60s, renewed on heartbeat).

    HTTP push endpoint /v1/push:

        Look up Redis, forward to correct pod (in dev, single pod, no forwarding).

        Wait for client ACK.

    Graceful shutdown cleanup.

Run: pnpm dev:gateway
3.3 Notification Service (Node.js)

    HTTP endpoint /v1/notify.

    Check consent (dev: mock).

    Send email via SendGrid test API (or fake SMTP).

    Log to notification.log.

Run: pnpm dev:notification
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

Run: pnpm dev:admin-api
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