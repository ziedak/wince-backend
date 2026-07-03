 Decision Engine

Single source of truth for implementation. Incorporates all reviews, optimisations, and decisions.
1. Executive Summary

We will keep a single deployment (decision-engine) with logical separation between Risk Scoring and Intervention Pipeline modules. This preserves the sub‑100ms fast path, avoids a network hop, and allows future extraction without rewriting.

Critical correctness bugs (budget source of truth, duplicate‑intervention race, lock TTL, fail‑open feature fetch) are fixed before launch. Resilience (circuit breakers, fallbacks, alerting) and admin APIs (risk read, manual intervention) are built in.
2. Architecture Overview
2.1 High‑Level Diagram

flowchart TD
    subgraph "Decision Engine (Single Deployment)"
        A[Kafka Consumer] --> B[Event Router]
        C[HTTP Trigger /v1/trigger] --> B
        D[Scheduler Worker] --> B
        E[Stale Scanner] --> B
        
        B --> F{tryAcquireLock}
        F -->|Lock acquired| G[RiskScorer]
        F -->|Lock failed| H[Skip]
        
        G --> I{Risk > Threshold?}
        I -->|Yes| J[Intervention Pipeline]
        I -->|No| K[Schedule Re-eval]
        
        J --> L[Pre-Filter Policy]
        L --> M[Uplift Estimator]
        M --> N[Value Optimizer]
        N --> O[Channel Selector]
        O --> P[Post-Validate]
        P --> Q[Outbound]
        Q --> R[Gateway / Notification]
        
        S[Admin API /risk/*] --> G
        T[Admin API /intervention/manual] --> J
    end
    
    subgraph "Resilience"
        U[Circuit Breaker] --> G
        V[Feature Degraded Alert] --> G
        W[Fast Path Fallback] --> G
    end
    
    subgraph "Idempotency"
        X[Bloom Filter] --> B
        Y[lock:sent] --> F
    end

2.2 Key Design Decisions
Decision	Rationale
Single deployment	No network hop; sub‑100ms fast path preserved.
Logical separation	Modules have clear boundaries; future extraction is a configuration change.
Unified entry point	All paths (HTTP, Kafka, Scheduler) call tryAcquireLock to prevent duplicate interventions.
Two‑tier locking	Phase 1 (risk scoring) is unlocked; Phase 2 (intervention) uses exclusive lock with fencing token.
Bounded outbound calls	WebSocket: 100ms timeout; Notification: 2s timeout. Prevents indefinite lock holding.
Heartbeat lock renewal	Lock TTL = 30s, renewed every 5s while pipeline runs.
Fallback risk scoring	Uses last known Redis risk, or rule‑based derived from per‑store policy config.
Admin risk APIs	Read risk, recalc, manual intervention (respects budget, supports cooldown override).
3. Service Catalog (Logical Modules)
Module	Responsibility	Key Files
Event Router	Routes events from all entry points to the unified lock/risk flow.	src/event-router/
Lock Service	Distributed Redis lock with fencing token, heartbeat, TTL management.	src/lock/
Risk Scorer	Hybrid scoring (rules + ONNX) with circuit breaker, feature fetch, policy load.	src/risk/
Features	ClickHouse batch feature fetch with Redis cache and degraded alerting.	src/features/
Policy	Store‑level policy loader from PostgreSQL with Redis cache.	src/policy/
Cooldown	Per‑customer cooldown state.	src/cooldown/
Budget	Daily budget with PostgreSQL source of truth, Redis write‑through cache.	src/budget/
Scheduler	Delayed re‑evaluation queue (Redis sorted set).	src/scheduler/
Stale Scanner	Detects abandoned sessions via active:sessions sorted set.	src/stale-scanner/
Intervention Pipeline	Orchestrates uplift, value, channel selection, policy, outbound.	src/intervention/
Discount	Unique discount code generation.	src/discount/
Outbound	Delivery to Gateway (WebSocket) or Notification (email/SMS).	src/outbound/
Admin API	Risk read, recalc, manual intervention endpoints.	src/admin/
Health	Liveness/readiness probes.	src/health.ts
Metrics	Prometheus metrics.	src/metrics.ts
4. Data Flow Diagrams
4.1 Fast Path (HTTP Trigger) — Sub‑100ms

sequenceDiagram
    participant ES as Enrichment Service
    participant DE as Decision Engine
    participant Redis as Redis
    participant ML as ONNX Model
    participant GW as Gateway

    ES->>DE: POST /v1/trigger (event)
    DE->>DE: Auth (internal secret)
    DE-->>ES: 202 Accepted (async)
    
    DE->>Redis: tryAcquireLock(sessionId)
    Redis-->>DE: Lock acquired (token)
    
    DE->>Redis: Get session state
    Redis-->>DE: Session features
    
    par Risk Scoring
        DE->>DE: Rule Engine (parallel)
        DE->>ML: ONNX predict (50ms timeout)
        ML-->>DE: Confidence
    end
    
    DE->>DE: Merge scores (rules + ONNX)
    DE->>Redis: Store risk score
    
    alt Risk > Threshold
        DE->>DE: Intervention Pipeline
        DE->>GW: POST /v1/push (100ms timeout)
        GW-->>DE: ACK
        DE->>Redis: Release lock
        DE->>Redis: Set lock:sent
    else Risk <= Threshold
        DE->>Redis: Schedule re-eval (backoff)
        DE->>Redis: Release lock
    end

4.2 Kafka Path — Standard Processing

sequenceDiagram
    participant K as Kafka
    participant DE as Decision Engine
    participant Redis as Redis
    participant ML as ONNX Model
    participant GW as Gateway

    K->>DE: enriched.events (trigger type)
    DE->>DE: Filter event type
    
    DE->>Redis: tryAcquireLock(sessionId)
    Redis-->>DE: Lock acquired (token)
    
    DE->>Redis: Get session state
    Redis-->>DE: Session features
    
    par Risk Scoring
        DE->>DE: Rule Engine (parallel)
        DE->>ML: ONNX predict (50ms timeout)
        ML-->>DE: Confidence
    end
    
    DE->>DE: Merge scores
    DE->>Redis: Store risk score
    
    alt Risk > Threshold
        DE->>DE: Intervention Pipeline
        DE->>GW: POST /v1/push (100ms timeout)
        GW-->>DE: ACK
        DE->>Redis: Release lock
        DE->>Redis: Set lock:sent
    else Risk <= Threshold
        DE->>Redis: Schedule re-eval (backoff)
        DE->>Redis: Release lock
    end

4.3 Scheduler Worker — Re‑evaluation

sequenceDiagram
    participant S as Scheduler Worker
    participant Redis as Redis
    participant DE as Decision Engine

    loop Every 1 second
        S->>Redis: ZRANGEBYSCORE eval:queue 0 now
        Redis-->>S: due sessions (max 100)
        S->>DE: Process each session
        DE->>Redis: tryAcquireLock(sessionId)
        Redis-->>DE: Lock acquired
        DE->>DE: Risk Scorer (uses cached features)
        DE->>Redis: Store new risk score
        alt Risk > Threshold
            DE->>DE: Intervention Pipeline
        else Risk <= Threshold
            DE->>Redis: Schedule re-eval (backoff)
        end
        DE->>Redis: Release lock
    end

4.4 Stale Scanner — Safety Net

sequenceDiagram
    participant SS as Stale Scanner
    participant Redis as Redis
    participant DE as Decision Engine

    loop Every 5 minutes
        SS->>Redis: ZRANGEBYSCORE active:sessions 0 (now - 2min)
        Redis-->>SS: stale sessions
        SS->>DE: Process each stale session
        DE->>Redis: tryAcquireLock(sessionId)
        Redis-->>DE: Lock acquired
        DE->>DE: Risk Scorer
        DE->>Redis: Store risk score
        alt Risk > Threshold
            DE->>DE: Intervention Pipeline (off-shop)
        end
        DE->>Redis: Release lock
    end

5. Data Stores (Detailed)
5.1 Redis Key Patterns
Key Pattern	Type	TTL	Value Example
session:{sessionId}	Hash	30 min	{cart_value: 89.99, rage_click_count: 2, last_activity: 1749283200}
risk:{sessionId}	String	60 s	0.87
risk:high	Sorted Set	persistent	{sessionId: score}
eval:queue	Sorted Set	persistent	{sessionId: timestamp}
active:sessions	Sorted Set	auto‑expire	{sessionId: timestamp}
lock:session:{sessionId}	String	30 s	{token: "uuid", expires: timestamp}
lock:cart:{cartId}	String	10 s	{token: "uuid"}
lock:sent:{sessionId}	String	5 min	1
policy:store:{storeId}	String	5 min	{minCartValue: 10, maxDiscount: 20, cooldown: 3600}
budget:{storeId}:{date}	String	24 h	45.50 (write‑through cache from PG)
cooldown:{storeId}:{distinctId}	String	policy.cooldown	1
feature:{storeId}:{distinctId}	String	1 h	{abandonment_rate_7d: 35.2, avg_cart_value_30d: 124.50}
idem:bloom	Bloom Filter	persistent	– (RedisBloom)
5.2 PostgreSQL Tables (Key Columns)
Table	Key Columns	Purpose
daily_budget	store_id, date, total_discount_given	Source of truth for budget
discount_codes	code, store_id, session_id, value, expires_at, used_at	Generated discount codes
interventions	intervention_id, session_id, store_id, type, value, sent_at, delivered, converted	Audit log
policy_rules	store_id, rule_type, parameters, enabled	Store policies
processed_events	event_id, processed_at	Idempotency fallback
5.3 ClickHouse Table
Column	Type	Description
timestamp	DateTime64(3)	Event timestamp
event_type	LowCardinality(String)	checkout_abandon, exit_intent, etc.
session_id	String	Session identifier
distinct_id	String	User identifier
store_id	UInt32	Tenant
cart_value	Float64	Current cart total
rage_click_count	UInt8	Frustration signal
is_frustrated	Bool	Derived frustration flag
properties	JSON	Additional event properties
server_timestamp	DateTime64(3)	Ingestion time
6. Critical Fixes (P0) — Actionable Tasks
#	Issue	Task	Effort
1	Budget source of truth	Verify budget.service.ts; ensure PostgreSQL authoritative with Redis write‑through cache; add reconciliation worker (15 min, alert on >5% drift)	1d
2	Duplicate‑intervention race	Implement single entry point tryAcquireLock() with fencing token; add integration test	2d
3	Lock TTL vs pipeline duration	Set TTL = 30s, heartbeat renewal every 5s; bound outbound calls (100ms/2s)	1d
4	Fail‑open feature fetch	Add decision_degraded_features_total metric; alert on >5% rate	0.5d
7. Admin API & Resilience (P1)
7.1 Admin Endpoints
Endpoint	Method	Description
/api/risk/{sessionId}	GET	Return current risk score (from Redis)
/api/risk/user/{userId}	GET	List all sessions for user with risk scores
/api/risk/active?limit=100	GET	Paginated list of active sessions with risk > threshold
/api/risk/recalculate/{sessionId}	POST	Trigger fresh risk scoring; return new score
/api/intervention/manual	POST	Admin‑triggered intervention (skips risk threshold). Body: {sessionId, type, value, overrideCooldown?}

Manual intervention behaviour:

    Always respects budget (fails if budget exhausted).

    Respects cooldown unless overrideCooldown: true (audit‑logged).

    Logs source: 'manual'.

7.2 Resilience Mechanisms
Mechanism	Implementation
Circuit Breaker for ONNX	Open after 5 failures in 1 min; skip ONNX for 5 min; metric onnx_fallback_total.
Fast‑Path Fallback	If risk scorer unavailable: use last known Redis risk; else rule‑based derived from per‑store policy config (not hardcoded).
Feature Degraded Alerting	Alert when >5% of decisions use zero features.
Readiness Probe	Check Kafka consumer, Redis, ONNX state; return 503 until ready.
8. Performance Optimisations (P2)
#	Task	Effort
1	Pre‑filter policy – Run eligibility checks before ML inference	1d
2	Batch feature fetch – ClickHouse batch queries for scheduler/stale scanner	0.5d
3	Circuit breaker for ONNX (already in P1)	0.5d
4	Cooldown key – Use distinct_id instead of customerId	0.5d