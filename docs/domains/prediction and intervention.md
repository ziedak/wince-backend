Complete Recap: Optimised Prediction + Intervention Architecture

This document is the final, consolidated architecture for the Decision Engine and Intervention Pipeline. It incorporates all optimisations, critiques, and fixes from our extensive discussions.
1. Core Principle: Two Phases, Not One

flowchart LR
    subgraph "Phase 1: Prediction"
        A[Risk Scorer] --> B{Risk > Threshold?}
    end
    
    subgraph "Phase 2: Intervention"
        B -->|Yes| C[Candidate Generator]
        C --> D[Uplift Estimator]
        D --> E[Value Optimizer]
        E --> F[Channel Selector]
        F --> G[Policy Enforcer]
    end
    
    B -->|No| H[Schedule Re-evaluation]

Phase	Purpose	Output
Prediction	Determine if this session is at risk of abandoning	Risk score (0–1)
Intervention	Decide what to offer, how much, and via which channel	Concrete action
2. Event Processing – Three Tiers

flowchart TD
    A[Enriched Event Arrives] --> B{Event Type?}
    
    B -->|"Trigger Events"<br/>checkout_abandon<br/>exit_intent<br/>rage_click<br/>add_to_cart (high value)| C[FAST PATH]
    B -->|"Update Events"<br/>page_view<br/>scroll_depth<br/>product_view| D[SLOW PATH]
    B -->|"Stale Detection"<br/>No events for 2+ min| E[SAFETY NET]
    
    C --> F[Immediate Risk Scorer<br/>(bypass Kafka)]
    F --> G{Risk > Threshold?}
    G -->|Yes| H[Immediate Intervention<br/>WebSocket push]
    G -->|No| I[Schedule Re-evaluation<br/>backoff: 30s–5min]
    
    D --> J[Update Session Cache<br/>No ML inference]
    J --> K[Stale Scanner<br/>Every 5 minutes]
    K --> L[Re-evaluate sessions<br/>no recent trigger]
    L --> M{High Risk?}
    M -->|Yes| N[Intervention via fallback]

Tier	Latency	Use Case
Fast Path	< 100ms	Explicit abandonment signals
Slow Path	< 1ms (state update)	Passive events, no immediate action
Safety Net	Up to 5 minutes	Silent abandonment (closed tab, etc.)
3. Session State Management (Pre‑aggregated)

Redis stores pre‑computed features for each session, updated on every event.

graph LR
    subgraph "Enrichment Service"
        A[Process Raw Event]
    end
    
    subgraph "Redis Session State"
        B[`session:{id}`]
        B --> C[cart_value]
        B --> D[rage_click_count]
        B --> E[last_activity]
        B --> F[time_on_page]
        B --> G[is_frustrated]
        B --> H[event_count]
    end
    
    subgraph "Decision Engine"
        I[Risk Scorer]
    end
    
    A -->|Update on every event| B
    I -->|Reads features directly| B
    I -->|Writes score| J[`risk:{id}` TTL 60s]

Additionally:

    ZADD active:sessions <timestamp> <session_id> on every event – for efficient stale session detection.

    ZADD eval:queue <next_eval_timestamp> <session_id> – schedules re-evaluation.

4. Risk Assessment & Scheduling (Corrected)
4.1 Immediate Trigger (Fast Path)

Trigger events bypass Kafka and are sent directly via gRPC/HTTP from Enrichment Service to Decision Engine.

sequenceDiagram
    participant E as Enrichment Service
    participant R as Redis
    participant D as Decision Engine
    participant M as ML Model
    participant G as Gateway

    E->>R: Update session state
    E->>D: gRPC (trigger event)
    D->>R: Fetch session features
    R-->>D: Features
    D->>M: Predict risk
    M-->>D: score = 0.87
    alt score > 0.6
        D->>D: Run Intervention Pipeline
        D->>G: Push WebSocket
        G-->>D: ACK
    else score <= 0.6
        D->>R: ZADD eval:queue <timestamp> <session_id>
    end

4.2 Scheduled Re‑evaluation (Backoff)

Instead of relying on TTL expiry, we use a Redis sorted set as a delayed job queue.

flowchart TD
    A[Risk Score Computed] --> B{Score Range}
    
    B -->|0.0–0.3| C[Low Risk<br/>Re-evaluate in 5 min]
    B -->|0.3–0.5| D[Medium Risk<br/>Re-evaluate in 2 min]
    B -->|0.5–0.6| E[High Risk<br/>Re-evaluate in 30 sec]
    B -->|> 0.6| F[Above Threshold<br/>Trigger Intervention]
    
    C --> G[ZADD eval:queue<br/>timestamp = now + 5min]
    D --> H[ZADD eval:queue<br/>timestamp = now + 2min]
    E --> I[ZADD eval:queue<br/>timestamp = now + 30s]
    
    J[Worker every 1 sec] --> K[ZRANGEBYSCORE eval:queue 0 now]
    K --> L[Pop due sessions]
    L --> M[Re-run Risk Scorer]

4.3 Stale Scanner (Safety Net)

Runs every 5 minutes using a sorted set of active sessions.

flowchart LR
    A[Stale Scanner<br/>Every 5 min] --> B[ZRANGEBYSCORE `active:sessions`<br/>0, now - 2min]
    B --> C[Stale sessions]
    C --> D[Fetch features]
    D --> E[Run Risk Model]
    E --> F{Score > Threshold?}
    F -->|Yes| G[Intervention via fallback]
    F -->|No| H[Schedule re-eval<br/>ZADD eval:queue]

5. Intervention Pipeline (Phase 2)

Only executed when risk > threshold. Includes two‑pass policy enforcement.

flowchart TD
    A[Risk > Threshold] --> B{Try Intervention Lock<br/>`SETNX lock:intervention:{session_id}`}
    B -->|Lock acquired| C[Proceed]
    B -->|Lock failed| D[Skip – intervention already in flight]
    
    C --> E[Candidate Generator]
    E --> F[Pre‑Filter Policy<br/>eligibility, budget, cooldown]
    F --> G[Filtered Candidate Set]
    
    G --> H[Uplift Estimator<br/>Batched Inference]
    H --> I[Value Optimizer]
    I --> J[Channel Selector]
    J --> K[Post‑Validate Policy<br/>final sanity check]
    
    K --> L{Active WebSocket?}
    L -->|Yes| M[Push Immediately<br/>< 50ms]
    L -->|No| N[Enqueue in Notification Queue]
    
    M --> O[Async Log<br/>Kafka `intervention.log`]
    N --> O

Intervention Pipeline Steps (Detailed)
Step	Purpose	Type	Cost
Candidate Generator	List possible interventions (discount, free_shipping, urgency, email)	Rule	< 0.5 ms
Pre‑Filter Policy	Eligibility, budget, cooldown, blacklists	Rule (Redis)	< 1 ms
Uplift Estimator	Estimate incremental conversion for each candidate (batched)	ML (ONNX)	5‑10 ms
Value Optimizer	Determine optimal value (e.g., discount %)	ML/Regression	2‑5 ms
Channel Selector	Choose delivery channel (WebSocket, email, SMS)	ML/Rule	1‑2 ms
Post‑Validate	Final sanity check on chosen action	Rule	< 0.5 ms

Total for sync path (WebSocket): ~15‑20 ms (excluding network).
6. Idempotency & Concurrency Guards
6.1 Intervention Lock (Session‑Level)

    Before entering the Intervention Pipeline, try SETNX lock:intervention:{session_id} 1 EX 30.

    If lock exists, skip (another intervention is in flight).

    The Stale Scanner and Fast Path both acquire the lock, preventing races.

6.2 Cart‑Level Lock (Multi‑Tab Protection)

    If a user has the same cart open in two tabs, each tab has a different session_id, so the session lock would not prevent duplicate interventions for the same cart.

    Additional lock: SETNX lock:cart:{cart_id} 1 EX 300 (5 min cooldown). This is set when an intervention is sent.

    Both locks are tried before proceeding.

6.3 Intervention State

    After sending an intervention, store intervention:sent:{session_id} with TTL 5 minutes.

    This prevents re‑sending to the same session even if the lock expires.

7. Kafka Bypass for Trigger Events (Low Latency)

To achieve < 100ms fast path, trigger events bypass the second Kafka hop.

flowchart LR
    A[Enrichment Service] -->|Trigger Event| B[gRPC/HTTP<br/>to Decision Engine]
    A -->|Async| C[Kafka `enriched.events`]
    
    B --> D[Immediate Risk Scorer]
    D --> E[Intervention Pipeline]
    E --> F[WebSocket Push]
    
    C --> G[Analytics Consumer<br/>to ClickHouse]
    C --> H[Other Consumers]

    Trigger events are sent synchronously to the Decision Engine.

    All events are still written to Kafka for durability and analytics.

8. Logging & Observability

    All decision logs are asynchronous – sent to Kafka intervention.log after the WebSocket push.

    No blocking writes to PostgreSQL or ClickHouse in the hot path.

    Prometheus metrics:

        risk_scores_distribution

        intervention_sent_total (by type, channel)

        pipeline_latency_seconds (p95, p99)

        lock_contention_rate

        kafka_consumer_lag (for non‑trigger consumers)

9. Scalability Optimisations
Component	Optimisation
Stale Scanner	Uses ZRANGEBYSCORE on active:sessions sorted set (O(log N)), instead of SCAN (O(N)).
Scheduler	Uses eval:queue sorted set for per‑session re‑evaluation, not TTL expiry.
Uplift Estimator	Batched inference – one ONNX call for all candidates, not per‑candidate.
Kafka	Trigger events bypass Kafka for low latency; Kafka still used for durability.
Redis	Separate logical DBs for session state, risk scores, locks, queues.
10. Fallback & Failure Handling
Failure	Action
ML model fails (confidence low)	Fallback to rule‑based risk (e.g., cart > $200 → high risk)
Redis outage	Read last known session state from Kafka (enriched event)
WebSocket unavailable	Queue intervention to Notification Service (email/SMS)
Lock acquisition fails	Skip intervention – user already receiving one
Budget exhausted	Fallback to free intervention (email reminder)
11. Complete End‑to‑End Data Flow

flowchart TD
    subgraph "Client"
        A[Tracker] -->|Events| B[API Gateway]
    end

    subgraph "Ingestion & Enrichment"
        B -->|raw.events| C[Ingestion Service<br/>Rust]
        C -->|raw.events| D[Kafka]
        D -->|raw.events| E[Enrichment Service<br/>Node.js]
        E -->|Update| F[(Redis Session State)]
        E -->|ZADD| G[(active:sessions)]
        E -->|enriched.events| D
        
        E -->|Trigger Events| H[Decision Engine<br/>Node.js]
        E -->|All events| D
    end

    subgraph "Decision & Intervention"
        H -->|Read| F
        H -->|Write| I[(eval:queue)]
        H -->|Scheduler| I
        H -->|Risk Scorer| J[ML Model<br/>ONNX]
        H -->|Intervention Pipeline| K[Intervention Logic]
        K -->|Push| L[WebSocket Gateway]
        K -->|Fallback| M[Notification Queue]
    end

    subgraph "Analytics & Storage"
        D -->|enriched.events| N[Analytics Consumer]
        N -->|Batch| O[(ClickHouse)]
        H -->|async| P[(Kafka intervention.log)]
        P --> Q[Audit, Billing]
    end

    L -->|WebSocket| R[Browser]
    M -->|Email/SMS| R