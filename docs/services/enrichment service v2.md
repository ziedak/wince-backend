Enrichment & Session Service — Final Specification

Source of truth for the Rust‑based Enrichment & Session Service. Incorporates all architectural decisions, optimisations, and feature‑engineering specifications from the design process.
1. Executive Summary

The Enrichment & Session Service is a Rust microservice that consumes raw events from Kafka, enriches them with customer and session context, computes time‑series features from the session window, and produces enriched events to Kafka for downstream consumers (Decision Engine, Analytics Consumer).

Key responsibilities:

    Consume raw.events from Kafka.

    Resolve distinct_id → user_id (identity mapping).

    Maintain time‑based session windows (Redis Sorted Sets, 5‑minute TTL).

    Compute feature vectors (rolling aggregates, recency, intervention history, cart composition, funnel context, EWMA).

    Attach features to the enriched event and produce to enriched.events.

Performance targets:

    p99 latency: < 15ms per event (including feature extraction).

    Throughput: > 10,000 events/sec per pod.

    Availability: 99.95% monthly.

2. Architectural Overview
2.1 Data Flow

flowchart TD
    A[Kafka: raw.events] --> B[Enrichment Service]
    B --> C[Resolve user_id]
    C --> D[Update session window<br/>Redis Sorted Set]
    D --> E[Feature Extraction]
    E --> F[Attach features to event]
    F --> G[Kafka: enriched.events]
    
    subgraph Redis
        H[`session:window:{session_id}`<br/>Sorted Set, 5min TTL]
        I[`session:seen:{event_id}`<br/>Idempotency, 5min TTL]
        J[`session:{session_id}`<br/>Hash, 30min TTL]
    end

2.2 Service Responsibilities
Module	Responsibility
Kafka Consumer	Reads raw.events, manages offsets, error handling, DLQ routing.
Identity Resolution	Maps distinct_id → user_id (PostgreSQL via Redis cache).
Session Window Manager	Maintains time‑based window in Redis Sorted Set, atomic via Lua script.
Feature Extractor	Computes rolling aggregates, recency, intervention history, cart composition, funnel context, EWMA.
Enriched Event Producer	Serialises enriched event with feature vector to enriched.events.
Health & Metrics	Exposes /live, /ready, and Prometheus metrics.
3. Redis Data Model
3.1 Keys
Key Pattern	Type	TTL	Purpose
session:window:{session_id}	Sorted Set (score = timestamp)	5 min	Time‑based event window for feature extraction.
session:seen:{event_id}	String	5 min	Idempotency: prevents duplicate event insertion.
session:{session_id}	Hash	30 min	Session state: EWMA values, recency timestamps, intervention counts, cart metadata.
3.2 Lua Script (Atomic Window Update)

All window operations are performed in a single atomic Lua script:
lua

-- KEYS[1]: session:window:{session_id}
-- KEYS[2]: session:seen:{event_id}
-- KEYS[3]: session:{session_id}
-- ARGV[1]: event_id
-- ARGV[2]: timestamp
-- ARGV[3]: event_json
-- ARGV[4]: current_time

-- 1. Idempotency check
if redis.call('SETNX', KEYS[2], 1) == 0 then
    return {0, 'duplicate'}
end
redis.call('EXPIRE', KEYS[2], 300)

-- 2. Add event to window
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])

-- 3. Remove events older than 5 minutes
local cutoff = ARGV[4] - 300
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', cutoff)

-- 4. Compute count features
local rage_30s = redis.call('ZCOUNT', KEYS[1], ARGV[4] - 30, '+inf')
-- ... other ZCOUNTs

-- 5. Update session hash (EWMA, recency)
redis.call('HSET', KEYS[3], 'last_event_ts', ARGV[4])
-- ... other HSETs

-- 6. Return features
return {1, rage_30s, ...}

4. Feature Engineering Specification
4.1 Feature Categories
Category	Features	Calculation Method
Rolling Aggregates	rage_clicks_30s, add_to_cart_60s, exit_intent_5m	ZCOUNT on session window.
Recency	seconds_since_last_event, seconds_since_last_add	From session hash (updated per event).
Velocity (EWMA)	ewma_events_per_minute, ewma_scroll_velocity	Exponential moving average updated per event.
Cart Composition	item_count, avg_item_price, has_discount, distinct_categories	From cart state (backend events).
Funnel Context	checkout_step_reached (0–3), unique_pages_visited	From event payload and window.
Intervention History	interventions_shown_this_session, time_since_last_intervention	From session hash (set by Decision Engine via Kafka).
Pattern Detection	rage_after_add, exit_after_checkout, idle_after_high_cart	Rust logic on window.
Behavioral Entropy	unique_event_types	Count distinct event types in window.
Schema Version	feature_schema_version	Static constant (e.g., v1).
4.2 Feature Calculation Details
Rolling Aggregates (via ZCOUNT)
Feature	Time Window	Redis Command
rage_clicks_30s	30 seconds	ZCOUNT window (now - 30s) +inf
add_to_cart_60s	60 seconds	ZCOUNT window (now - 60s) +inf
exit_intent_5m	5 minutes	ZCOUNT window (now - 300s) +inf
Recency (from session hash)
Feature	Update Rule
seconds_since_last_event	now - last_event_ts
seconds_since_last_add	now - last_add_ts (set on add_to_cart events)
EWMA (Exponential Weighted Moving Average)

For continuous features like events_per_minute and scroll_velocity_30s:

    alpha = 0.1 (decay factor for ~10‑event half‑life).

    On each event:
    text

ewma_value = alpha * current_value + (1 - alpha) * ewma_value

    Stored in session hash: ewma_events_per_minute, ewma_scroll_velocity.

Pattern Detection (Rust logic on window)
Pattern	Condition
rage_after_add	Rage click occurs within 10 seconds after the latest add_to_cart.
exit_after_checkout	exit_intent occurs within 30 seconds after checkout_start.
idle_after_high_cart	idle_timeout occurs after add_to_cart with cart_value > $100.
Missing Values

    Any feature that cannot be computed (e.g., insufficient history) emits null.

    XGBoost native missing‑value handling will be used.

5. Processing Flow (Per Event)

sequenceDiagram
    participant K as Kafka
    participant E as Enrichment Service
    participant R as Redis
    participant P as PostgreSQL

    K->>E: raw.events (batch)
    loop For each event
        E->>R: SETNX session:seen:{event_id}
        alt Duplicate
            E->>E: Skip
        else New
            E->>R: Lua script (atomic window update + feature extraction)
            R-->>E: Feature vector
            E->>P: Resolve distinct_id → user_id (cached)
            E->>E: Enrich event with features + user_id
            E->>K: produce to enriched.events
        end
    end

6. Idempotency & Fault Tolerance
Concern	Mechanism
Duplicate events (Kafka at‑least‑once)	SETNX session:seen:{event_id} EX 300 – skip if key exists.
Concurrent writes (same session)	Atomic Lua script ensures read‑modify‑write consistency.
Redis failure	Retry with exponential backoff; if persistent, write to DLQ.
Kafka consumer rebalance	Commit offsets only after successful processing; use cooperative rebalancing.
Missing history	Emit null for unavailable features; do not backfill with zero.
7. Configuration
Environment Variable	Default	Description
KAFKA_HOSTS	kafka:29092	Kafka bootstrap brokers
KAFKA_TOPIC_RAW	raw.events	Input topic
KAFKA_TOPIC_ENRICHED	enriched.events	Output topic
KAFKA_GROUP_ID	enrichment-group	Consumer group ID
REDIS_URL	redis://redis:6379	Redis connection URL
POSTGRES_URL	postgresql://...	PostgreSQL connection (via PgBouncer)
SESSION_WINDOW_TTL_SECONDS	300	Time‑based window TTL
IDEMPOTENCY_TTL_SECONDS	300	Idempotency key TTL
SESSION_TTL_SECONDS	1800	Session hash TTL
EWMA_ALPHA	0.1	Decay factor for EWMA features
LOG_LEVEL	info	Tracing filter
8. Performance Optimisation
Technique	Benefit
Atomic Lua script	Single Redis round‑trip for window update + feature extraction.
ZCOUNT for rolling aggregates	No deserialisation; O(log N) per feature.
EWMA for velocity features	O(1) update per event; no window scan.
Batch Redis pipelines	Multiple ZCOUNT calls in one pipeline.
Tokio multi‑threaded runtime	High concurrency for I/O and CPU‑bound work.
spawn_blocking for feature extraction	Offloads CPU‑heavy logic to blocking threads.
Connection pooling	Reuse Redis and PostgreSQL connections.
9. Observability
Metrics (Prometheus)
Metric	Type	Labels
enrichment_events_processed_total	Counter	status (success, duplicate, error)
enrichment_latency_seconds	Histogram	p50, p95, p99
enrichment_redis_latency_seconds	Histogram	operation (zadd, zcount, lua)
enrichment_kafka_lag	Gauge	partition
enrichment_feature_extraction_time_seconds	Histogram	–
Health Checks

    /live – always 200 if process is running.

    /ready – 200 only when Kafka consumer joined group and Redis/PostgreSQL connections are healthy.

Alerts

    enrichment_events_processed_total{status="error"} rate > 10/min → page on‑call.

    enrichment_redis_latency_seconds p99 > 10ms for 5 min → investigate Redis.

    enrichment_kafka_lag > 1000 for any partition → scale consumers.

10. Implementation Roadmap
Phase 1 – Core Service (Week 1)

    Kafka consumer setup (cooperative rebalancing, manual commits).

    Identity resolution (PostgreSQL cache in Redis).

    Session window (Redis Sorted Set with time‑based TTL).

Phase 2 – Feature Extraction (Week 2)

    Rolling aggregates (ZCOUNT in Lua script).

    Recency features (session hash).

    Pattern detection (Rust logic on window).

    EWMA values (session hash).

Phase 3 – Enriched Event Production (Week 3)

    Serialise enriched event with feature vector.

    Produce to enriched.events.

    Error handling & DLQ routing.

Phase 4 – Optimisation & Observability (Week 4)

    Lua script optimisation (single round‑trip).

    Batch processing & pipeline improvements.

    Metrics, health checks, alerts.

    Load testing & tuning.

11. Open Items (Resolved)
Item	Resolution
Count‑based trimming vs. time‑based trimming	Time‑based trimming (Sorted Set + ZREMRANGEBYSCORE).
Idempotency on window writes	SETNX session:seen:{event_id}.
Atomic read‑modify‑write	Lua script for entire window update + feature extraction.
Missing history	Emit null for unavailable features; XGBoost native missing‑value handling.
Feature schema versioning	Include feature_schema_version in enriched event.
Rage‑after‑add detection	Use .max_by_key() for latest add; require rage.timestamp > add.timestamp.
EWMA vs. hard windows	EWMA for events_per_minute and scroll_velocity_30s.