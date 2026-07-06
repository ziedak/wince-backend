Decision Engine — Final Detailed Recap (Risk Scoring vs. Prediction & Admin Approval)

Complete specification incorporating all decisions about risk scoring, future prediction, window-based feature extraction, model updates, prediction horizon, and the admin approval workflow.
1. Core Distinction: Risk Scoring vs. Prediction
Aspect	Risk Scoring	Prediction
Definition	Estimate of the current risk of abandonment right now, based on the user’s current session state and recent behaviour.	Forecast of the probability that the user will abandon the cart in the near future (e.g., in the next 5, 10, or 30 minutes).
Input	Real‑time features (window_features from Enrichment, recency, cart value, etc.).	Same features, but the model is trained to predict a future outcome (e.g., conversion within the next T minutes).
Model	Typically a classifier or regression model trained on historical data.	Typically a binary classifier (will abandon in next T minutes) or a survival model.
Output	A score (0–1) representing the current risk.	A probability (0–1) of abandonment within a defined time horizon.
Business use	Triggers immediate interventions (e.g., popup, email).	Used for proactive interventions (e.g., send a discount before the user actually leaves) and for escalations.

Decision:

    The Decision Engine computes both a current risk score (for immediate actions) and a future prediction (for proactive targeting).

    Both are derived from the same feature vector will use different models with different training objectives

    The intervention recommendation is based on the prediction, not just the current risk. The current risk score is used for time‑sensitive decisions (e.g., if the user is about to close the tab, we must act now).

2. Window‑Based Feature Extraction (Enrichment Service)

Decision: Feature extraction is performed by the Enrichment & Session Service (Rust), not the Decision Engine. The Decision Engine receives a pre‑computed window_features object in every enriched event.
2.2 Window Storage (Redis)

    Data Structure: Redis Sorted Set (session:window:{session_id}), keyed by timestamp.

    TTL: 5 minutes (time‑based eviction via ZREMRANGEBYSCORE).

    Idempotency: SETNX session:seen:{event_id} prevents duplicate insertion.

    Atomicity: Lua script performs SETNX → ZADD → ZREMRANGEBYSCORE → ZCOUNT → HSET in one round‑trip.

3. Phase 1 – Risk Scoring (Current Risk) we will keep the current implementation
3.1 Input

    Enriched event containing:

        user_id (resolved by Enrichment).

        window_features (pre‑computed by Enrichment).

        store_id, cart_id, cart_value, etc.

3.2 Processing

    Fetch user‑level state from Redis (user:{userId}): risk_score, intervention_state, escalation_level.

    Fetch store policy from PostgreSQL (Redis cache).

    Check cooldown (cooldown:{store_id}:{userId}) – skip if active for a fresh episode.

    Compute risk:

        Rules engine runs in parallel with ONNX.

        ONNX inference (50ms timeout) takes the window_features vector as input.

        Merge logic:

            If ONNX confidence > 0.6 → ONNX determines type, channel, value.

            If ONNX fails, times out, or confidence ≤ 0.6 → use rules.

            If ONNX fails 5 times consecutively → circuit breaker opens for 5 minutes; skip ONNX entirely.

    Persist score to Redis:

        risk:user:{userId} (TTL 60s).

        active_risk:{storeId} sorted set (for Admin API pagination).

4. Phase 1 – Prediction (Future Abandonment Probability)
4.1 Purpose

    Forecast the probability that the user will abandon the cart in the next T minutes.

    This is the signal used to generate an intervention recommendation.

4.2 Prediction Horizon

    T = 5 minutes (default, configurable per store).

    The model is trained to predict: will_abandon_in_next_5_minutes (binary).

4.3 Model

    Same model family as risk scoring (XGBoost/ONNX), but trained on future‑looking labels.

    Training data: historical enriched events labelled with whether the user abandoned within 5 minutes of the event.

    Input features: Same window_features used for risk scoring.

4.4 Output

    prediction_probability (0–1): probability of abandonment in the next T minutes.

    prediction_confidence (0–1): model confidence.

If ONNX fails, times out, or confidence ≤ 0.6 → skip.

            If ONNX fails 5 times consecutively → circuit breaker opens for 5 minutes; skip ONNX entirely.
4.5 Threshold

    If prediction_probability > threshold (e.g., 0.6) or current_risk > threshold (e.g., 0.6), generate a recommendation.

Decision:  current risk or future prediction must exceed thresholds to trigger an intervention.
5. Model Training & Update
5.1 Training Data

    Historical enriched events with window_features (pre‑computed by Enrichment).

    Labels:

        Risk scoring: did_abandon (boolean – did the user abandon the cart?).

        Prediction: will_abandon_in_T_minutes (boolean – did the user abandon within T minutes of the event?).

5.2 Model Update

    Models are retrained weekly using new historical data.

    New models are deployed via rolling update (no downtime).

    A/B testing: canary deployment with shadow‑mode validation.

5.3 Training/Serving Skew Prevention

    Features are computed in the Enrichment Service and stored in ClickHouse.

    The training pipeline reads features from ClickHouse (same as online serving).

    feature_schema_version ensures consistency across time.

6. Phase 2 — Intervention Pipeline 
6.1 Locking (Critical)

Only Phase 2 is locked. Phase 1 runs unlocked (idempotent, last‑write‑wins).

Lock lifecycle:

    Before acquiring lock, check sent:user:{userId} – if present, skip (already sent).

    Acquire lock:user:{userId} with fencing token (monotonically increasing value).

    TTL: 30s, heartbeat renewal every 5s while pipeline runs.

    Every side‑effect write (budget reservation, outbound send) must check the fencing token before committing.

    On completion (success or terminal failure), release lock explicitly.

    If outbound delivery is queued for async retry, that counts as pipeline completion; lock is released immediately.

6.2 Pipeline Steps

    Pre‑filter policy (cheap, rule‑based, before ML): eligibility, discount caps, blacklist, store‑level exclusions.

    Candidate Generator – list possible intervention types given surviving candidates.

    Uplift Estimator – batched inference across all candidates (one ONNX call).

    Value Optimizer – determines discount value (ML‑influenced when confidence supports it).

    Channel Selector – active session with last_activity within 2 minutes → in‑shop WebSocket; otherwise off‑shop (email/SMS) based on consent flags.

    Budget gate – reserve discountValue against PostgreSQL daily_budget; skip with budget_exhausted if cap reached.

    Cooldown gate – check cooldown:{store_id}:{userId} for fresh episodes. Escalation uses a separate key (escalation:{store_id}:{userId}).

    Discount code generation – only for monetary in‑shop offers; atomic claim on redemption.

    Post‑validate policy – final sanity check before dispatch.

    Outbound delivery, bounded:

        WebSocket: 100ms timeout → fail over to notification-service.

        Email/SMS: 2s HTTP timeout → enqueue for retry (exponential backoff) → DLQ on exhaustion.

    Audit write – fire‑and‑forget to Kafka intervention.log and PostgreSQL interventions (includes experiment variant, risk confidence, escalation tier, and per‑session weight breakdown).

    Mark delivered, set cooldown, set sent:user (10 min), release lock, record metrics.

7. Admin Approval Workflow

The intervention should not auto‑execute, even if it costs the shop owner nothing. The admin must approve the intervention. The Decision Engine generates a recommendation, and the Admin API exposes it for review.
7.1 Configuration Options (Per Store)
Setting	Values	Description
intervention_approval_mode	manual (default) / auto_if_budget / auto_always	- manual: Every intervention requires explicit admin approval (via Admin API).
- auto_if_budget: Auto‑execute only if it does not exceed the store's budget; otherwise require approval.
- auto_always: Auto‑execute all interventions (subject to budget).
approval_timeout_seconds	Integer (default 600)	Time window for admin to approve/reject; if timeout, the recommendation expires.
budget_mode	per_day / per_campaign / unlimited	How the budget is applied.
7.2 Recommendation Generation

    Decision Engine computes both risk and prediction.

    If one or both exceed thresholds → generate recommendation.

    Write to:

        PostgreSQL intervention_recommendations table.

        Redis pending:store:{store_id} sorted set (for Admin API pagination).

        Kafka intervention.recommendations topic (optional, for audit).

    Do not execute unless approval mode is auto_always or auto_if_budget (and budget allows).

7.3 Admin API Endpoints
Method	Path	Description
GET	/admin/interventions/recommendations?status=pending&store_id=123	List pending recommendations.
POST	/admin/interventions/recommendations/{id}/approve	Approve and execute.
POST	/admin/interventions/recommendations/{id}/reject	Reject.
PUT	/admin/interventions/recommendations/{id}	Modify (e.g., change discount value) before approval.
PUT	/admin/stores/{store_id}/settings	Update approval mode, timeout, budget mode.
7.4 Auto‑Execution vs. Approval

    If approval_mode = auto_always, the Decision Engine still generates the recommendation but executes it immediately (bypassing the approval queue).

    If approval_mode = auto_if_budget, it checks the budget; if the budget is available, it auto‑executes; otherwise, it waits for approval.

    If approval_mode = manual, it never auto‑executes; the admin must approve every intervention