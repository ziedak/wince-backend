# Cart Recovery Decision Engine — System Specification

**Status:** Source of truth. Supersedes all prior architecture drafts and review documents.
**Scope:** Decision Engine, Admin API, and their shared data model. Enrichment, Tracker, and Ingestion services are referenced only where they affect this system's contract.

Items marked **OPEN** are unresolved design decisions. They are not assumptions — they must be explicitly decided before the affected component is built.

---

## 1. Identity & Core Entities

| Entity | Definition |
|---|---|
| User | A resolved shopper identity (`user_id`). Owns exactly one active cart. |
| Cart | Shared state across a user's sessions: `total`, `items`, `checkout_progress`, `created_at`. |
| Session | One browser tab or device. Sends behavioral events. Linked to a `cart_id`. |
| Behavioral Signals | Rage clicks, dead clicks, mouse hesitation, scroll depth, exit intent, idle timeout, time on page. |
| Backend Events | `add_to_cart`, `remove_from_cart`, `checkout_start`, `checkout_step`, `purchase`, `coupon_apply`. |

**RESOLVED — scope boundary.** Identity resolution and guest-cart merging are owned by the Enrichment & Session Service, not the Decision Engine. The Decision Engine's contract: every incoming event must carry a resolved `user_id` and `cart_id`. **A validation guard at every entry point rejects (routes to DLQ) any event missing either field** — this is a new explicit requirement, not implicit.

This closes the question of *where* identity resolution happens. It does **not** close the design of *how* Enrichment performs it. That design, proposed as device_id → user_id mapping with cart merge on login, has two unresolved problems that must be fixed before Enrichment implements it — tracked as a new item under Enrichment's own spec, not this document's scope, but listed here so it isn't lost:

1. **Cart state should follow the same pattern as budget: PostgreSQL as source of truth, Redis as write-through cache.** The originally proposed Redis-only `BEGIN/COMMIT` merge pseudocode has no real atomicity guarantee against Redis (no `WATCH`/`MULTI` or Lua script specified), and cart total directly drives discount eligibility and value — the same financial-correctness bar as budget applies here.
2. **The merge procedure itself needs a lock** (e.g. `lock:merge:{userId}`) to prevent two concurrent logins for the same user from double-merging, and an explicit answer for what happens to an event that arrives against the old guest cart while a merge is in flight.

**Accepted limitation, stated explicitly rather than assumed:** `device_id`-based guest tracking (e.g. via `localStorage`) will not survive private browsing, cache clears, or a second device the shopper never logs in on. In those cases the system will legitimately treat them as separate users with separate carts. This is acceptable — but it must be written down as a known limitation, not silently relied upon as a guarantee.

---

## 2. Data Model

### 2.1 Redis Keys

| Key | Type | TTL | Purpose | Notes |
|---|---|---|---|---|
| `user:{userId}` | Hash | — | `cart_id`, `risk_score`, `intervention_state`, `escalation_level`, `last_intervention_time` | Rolling behavioral aggregates (see 2.1a) also live here |
| `cart:{cartId}` | Hash | 24h | `total`, `items`, `item_count`, `checkout_progress`, `created_at`, `last_updated` | |
| `session:{sessionId}` | Hash | 30 min | `user_id`, `cart_id`, `last_activity`, `device_type`, `channel_type`, `rage_click_count`, `scroll_depth`, `time_on_page`, `exit_intent_count`, `idle_timeout_count` | `user_id` field required for resolution — see Section 1 OPEN item |
| `behavior:session:{sessionId}` | Stream, capped | 5 min | Raw behavioral events for ML feature extraction | Cap length server-side (e.g. `XADD ... MAXLEN ~5000`); confirm client-side sampling for high-frequency signals (mousemove) before ingestion |
| `active:sessions` | Sorted Set (score = `last_activity`) | auto | Global active-session index for stale detection | Never use `SCAN` against session keys |
| `active_risk:{storeId}` | Sorted Set (score = `risk_score`) | auto | Per-store index for `GET /api/risk/active` pagination and `min_score` filtering | Written alongside `risk:user:{userId}` on every score update. Required — the plain `active:sessions` set cannot support score-filtered pagination. |
| `risk:user:{userId}` | String | 60s | Cached aggregate risk score | |
| `lock:user:{userId}` | String | 30s, heartbeat-renewed every 5s | Exclusive lock — Phase 2 only (see 4.2) | Must include a fencing token (monotonic counter) |
| `sent:user:{userId}` | String | 10 min | Prevents duplicate sends within one intervention episode | Session-level idempotency — not a substitute for event-level idempotency |
| `eval:queue` | Sorted Set (score = next-eval time) | persistent | Delayed re-evaluation scheduler | Must be consumed by a worker; a bare Redis TTL on `risk:user:{userId}` does not trigger anything by itself |
| `cooldown:{store_id}:{userId}` | String | policy-defined (default 3600s) | Per-user cooldown between separate intervention episodes | Keyed on `user_id`, not `customerId` — see Section 4.3 |
| `budget:{store_id}:{date}` | String | 24h | Redis-side cache of daily spend | Write-through cache only — PostgreSQL `daily_budget` is authoritative (Section 2.2) |
| `policy:store:{store_id}` | String | 300s | Cached store policy | Preload on service startup |
| `feature:{store_id}:{userId}` | String | 3600s | Cached ClickHouse batch features | |
| `scan:lock` | String | 240s | Stale scanner distributed lock | |
| `processed_events:{event_id}` | Bloom filter + Postgres fallback | — | Event-level idempotency (Kafka redelivery) | Distinct from `sent:user` — see Section 4.2 |

**2.1a — Rolling aggregates on `user:{userId}`:** total rage clicks, average scroll depth, cumulative time on site. Updated incrementally by enrichment on each event. The Admin API's behavioral summary reads these fields directly — it does not recompute by fetching every session hash at request time.

### 2.2 PostgreSQL Tables

| Table | Purpose | Notes |
|---|---|---|
| `daily_budget` | Authoritative daily spend per store | Source of truth. Redis `budget:{store_id}:{date}` is a write-through cache. Reconciliation job compares the two every 15 minutes. |
| `policy_rules` | Store-level policy: cooldown minutes, max discount %, daily budget limit, min cart value | |
| `interventions` | Audit log | Must include: `experiment_id`, `variant`, `risk_confidence`, `escalation_tier`, and per-session weight breakdown (session_id, session_weight, session_risk) for every session that contributed to the aggregate score |
| `discount_codes` | Generated codes, 1h TTL | Redemption must be atomic: `UPDATE ... WHERE used = false RETURNING *`, not a separate check-then-set |
| `stores`, `admin_users` | Merchant/admin identity | `api_key_hash` on `stores`, bcrypt password on `admin_users` |
| `customers`, `customer_identities` | Identity mapping | |
| `processed_events` | Bloom-filter false-positive fallback | |
| `audit_logs` | All admin write operations, **and rejected privileged attempts** (e.g. `budget_exhausted` on a manual intervention) | |

### 2.3 ClickHouse

| View | Columns | Purpose |
|---|---|---|
| `mv_customer_features` | `store_id`, `user_id`, `abandonment_rate_7d`, `avg_cart_value_30d` | Batch historical features, fetched per user (not per session) |

---

## 3. Event Ingestion — Entry Points

Five entry points feed the decision pipeline. **All five must resolve to the same user-level lock in Section 4.2 — there is no separate correctness path for any of them.**

| Entry Point | Trigger | Latency Target |
|---|---|---|
| Kafka `enriched.events` | `checkout_abandon`, `exit_intent`, `idle_timeout` event types only; all others filtered | Standard |
| `POST /v1/trigger` | Fast-path HTTP call from enrichment-session | < 100ms |
| Scheduler Worker | Pops due sessions from `eval:queue` | Backoff-tiered: 30s / 2min / 5min by score band |
| Stale Scanner | `active:sessions` ZSET, sessions with `last_activity` > 2 min old | Every 5 min |
| Admin API (`recalculate`, `manual intervention`) | Explicit admin action | Proxied, 5s timeout |

Event classification tiers (unchanged from original design):

| Tier | Latency | Handling |
|---|---|---|
| Fast Path (trigger events) | < 200ms | Immediate risk scoring |
| Slow Path (update events: `page_view`, `scroll_depth`) | < 1ms | State update only, no inference |
| Safety Net (stale scanner) | Up to 5 min | Catches silent abandonment |

---

## 4. Decision Pipeline

### 4.1 Phase 1 — Risk Scoring (no lock required)

1. Resolve `user_id` from the incoming event (session, Kafka message, or scheduler entry).
2. Fetch `cart:{cartId}`.
3. Fetch all sessions linked to the user (pipelined multi-get, not sequential calls). Assumed max concurrent sessions per user: small (1–3) — confirm this assumption holds before scaling further.
4. Compute per-session features from session hash + `mv_customer_features`.
5. Compute weighted aggregate:

```
session_weight =
  1.0
  × (1 + 0.5 * log(cart_value + 1))
  × (1 + 0.3 * checkout_progress_factor)
  × (1 + 0.2 * rage_clicks)
  × (1 + 0.1 * scroll_depth/100)
  × (1 + 0.3 * (time_on_page / 60))
  × (1 + 0.5 * exp(-minutes_since_last_activity/10))
  × (1 + 0.3 if device == mobile else 0)

user_risk = (Σ session_weight × session_risk) / Σ session_weight
```

`session_weight` **must be capped** — e.g. `min(weight, 20)` as a placeholder ceiling — to prevent unbounded multiplication when several factors are high simultaneously. The specific cap value is itself uncalibrated; treat it as a starting point, not a final answer.

**Calibration process (defined, not yet executed):** run the formula in shadow mode against a baseline rule-based risk score for the first 2–4 weeks of production traffic (duration should ultimately be driven by reaching statistical significance, not the calendar). Use the shadow data to calibrate coefficients offline (e.g. logistic regression against actual conversion outcomes). Gate the calibrated version behind a feature flag until validated. **This resolves the process for calibration; the coefficients themselves remain uncalibrated and unvalidated until this process actually runs — do not treat the formula as trustworthy at scale until it has.**

6. Merge rules and ONNX:
   - Both run in parallel. ONNX has a 50ms timeout.
   - **If ONNX confidence > 0.6: ONNX determines type, channel, and value.** Rules are the fallback, not a permanent ceiling. (This corrects the earlier implementation, where rules were always authoritative regardless of ONNX confidence — that configuration makes the ML model unable to affect anything but a number nobody acts on.)
   - If ONNX times out, errors, or confidence ≤ 0.6: use rules.
   - If ONNX fails 5 times consecutively: open circuit breaker for 5 minutes, skip ONNX entirely, increment `onnx_fallback_total`.
7. If risk scoring itself cannot run (circuit breaker open, model unavailable, Redis/ClickHouse down): use last-known-good score from `risk:user:{userId}` if present and unexpired; otherwise apply the conservative fallback rule ladder (cart > 3× store's `min_cart_value` → 0.85; rage_click_count > 2 → 0.7; exit_intent → 0.6; else → 0.3, no intervention). Log every fallback occurrence with reason.
8. Persist score to `risk:user:{userId}` and `active_risk:{storeId}` (fire-and-forget).
9. If score ≥ threshold (0.6): proceed to Phase 2.
10. If score < threshold: push to `eval:queue` with backoff tier based on score band (0.5–0.6 → 30s, 0.3–0.5 → 2min, 0.0–0.3 → 5min). The Scheduler Worker (Section 5) is the only mechanism that acts on this — a bare Redis key TTL does nothing on its own.

**Feature degradation:** if ClickHouse is unavailable, zero features are returned and the decision proceeds — but `degraded_features_total` is incremented, and an alert fires if degraded decisions exceed 5% of volume in a 5-minute window. This branch silently disables the highest-confidence rule path (frustrated + high abandonment), so it must be observable, not silent.

### 4.2 Locking & Idempotency

Two separate mechanisms exist for two separate problems. They are not interchangeable.

| Mechanism | Scope | Problem it solves | Checkpoint |
|---|---|---|---|
| `processed_events` Bloom filter + Postgres fallback | Per Kafka message | Prevents reprocessing the same physical event on redelivery | Checked at the Kafka consumer level, before any business logic runs |
| `lock:user:{userId}` + `sent:user:{userId}` | Per user, per intervention episode | Prevents two different events (from any of the 5 entry points) from producing two interventions for the same user | `sent:user` checked after risk scoring, immediately before entering Phase 2 |

**Locking rule:** the exclusive lock gates **Phase 2 only**. Phase 1 (risk scoring) runs unlocked — its Redis writes are idempotent and last-write-wins, so concurrent recomputation is wasteful but not incorrect. Locking Phase 1 as well (as in an earlier draft) unnecessarily serializes cheap re-scoring behind the same lock as expensive, non-idempotent budget spend, and will cause routine re-scoring to be skipped under bursty event volume.

**Lock lifecycle:**
1. Before acquiring the lock, check `sent:user:{userId}`. If present, skip — no lock attempt needed.
2. Acquire `lock:user:{userId}` with a fencing token (monotonically increasing value, e.g. from `INCR`).
3. TTL: 30s. Renew every 5s while the pipeline runs.
4. Every write with a side effect that must not double-fire (budget reservation, outbound send) must check the fencing token before committing, to reject a stale holder that resumed execution after a stall (GC pause, network partition) past its TTL. Heartbeat renewal reduces this risk but does not eliminate it without the token check.
5. On completion (success or terminal failure), release the lock explicitly.
6. If outbound delivery is queued for async retry (Section 4.3, step 8), that counts as pipeline completion for locking purposes — the lock is released immediately; the retry worker enforces its own idempotency via `sent:user` and the intervention record's delivery status, not by holding the session lock across the retry backoff window.

All five entry points from Section 3 call the same `tryAcquireLock(userId)` function. There is no separate code path for the admin-triggered manual intervention or recalculation — routing those outside this lock would reopen the exact race this section exists to close.

### 4.3 Phase 2 — Intervention Pipeline

Runs only after lock acquisition.

1. **Pre-filter policy** (cheap, rule-based, before any ML/inference cost): eligibility, discount caps, blacklist, store-level exclusions. Runs first to avoid computing uplift/value on candidates that will be discarded regardless.
2. **Candidate Generator** — list possible intervention types given surviving candidates.
3. **Uplift Estimator** — batched inference across all candidates in one call, not looped per candidate.
4. **Value Optimizer** — determines discount value. Per Section 4.1 step 6, this should be ML-influenced when confidence supports it, not hardcoded.
5. **Channel Selector** — active session with `last_activity` within 2 minutes → in-shop WebSocket; otherwise off-shop (email/SMS) based on consent flags.
6. **Budget gate** — reserve `discountValue` against `daily_budget` in PostgreSQL (source of truth), update Redis cache. Skip with `budget_exhausted` if cap reached. **Fallback-mode risk scores (Section 4.1 step 7) go through this gate, and through the cooldown and `sent:user` guards, with no exception** — degraded scoring is exactly when financial guardrails matter most. Every fallback-sourced decision logs `source: fallback` on the audit record.
7. **Cooldown gate** — **RESOLVED — two separate keys:** `cooldown:{store_id}:{userId}` blocks any *new* intervention episode after a conversion or a final negative response; `escalation:{store_id}:{userId}` tracks the current escalation level during an *active* episode (Section 4.4) and is checked separately. The engine checks `cooldown` before starting a new episode and `escalation` while continuing an already-active one — they never gate each other.
8. **Discount code generation** — only for monetary in-shop offers. Atomic claim on redemption (Section 2.2).
9. **Post-validate policy** — final sanity check on the chosen action before dispatch.
10. **Outbound delivery**, bounded:
    - WebSocket: 100ms timeout → fail over to notification-service.
    - Email/SMS: 2s HTTP timeout → enqueue for retry with exponential backoff → DLQ on exhaustion.
    - These bounds are what make the 30s lock TTL safe. If either timeout is removed or loosened, the lock TTL assumption must be re-verified.
11. **Audit write** — fire-and-forget to Kafka `intervention.log` and PostgreSQL `interventions`, including experiment variant, risk confidence, escalation tier, and per-session weight breakdown (Section 2.2).
12. Mark delivered, set `cooldown`, set `sent:user` (10 min), release lock, record metrics.

### 4.4 Escalation

- If no conversion within `pending_ttl` (10 min), re-evaluate with fresh behavioral data via `eval:queue`.
- If risk persists, advance to the next escalation tier (stronger incentive).
- **Hard cap on escalation tiers is required** — none is currently specified. Without one, a persistently active non-converting user can escalate indefinitely, which is both a budget risk and a poor customer experience.
- **RESOLVED — model-driven by default, rule-based fallback.** When model confidence > 0.6, the model's `recommended_escalation_tier` and `recommended_value` drive the decision; otherwise fall back to a fixed ladder (e.g. 10% → 15% → 20% + free shipping). This mirrors the Phase 1 rules/ONNX merge and avoids regressing the personalization fix from Section 4.1 step 6. **Dependency: the ONNX model must be extended to emit `recommended_escalation_tier` and `recommended_value` fields** — it does not currently output these; this is a model/schema change, not just a routing decision. Every escalation decision logs whether it was model-driven or rule-based.
- **`escalation:{store_id}:{userId}`** is a separate key from `cooldown:{store_id}:{userId}` (Section 4.3 step 7). It is cleared on purchase or on an explicit dismissal event. **Gap: no dismissal event currently exists in the tracker's event schema.** Until one is added, `escalation:{store_id}:{userId}` must carry its own TTL (bounding the maximum escalation window) as a safety net — otherwise a user who never purchases and never explicitly dismisses keeps escalation state indefinitely.
- **Purchase must cancel pending escalation and scheduled re-evaluation.** On `purchase`: clear cart, clear `intervention_state`, clear `risk:user`, clear `sent:user`, clear escalation level, **and remove the user's pending `eval:queue` entry.** Without the last step, a scheduled re-evaluation can fire after purchase and target a converted customer.

---

## 5. Background Workers

| Worker | Behavior | Requirements |
|---|---|---|
| Scheduler Worker | Pops due entries from `eval:queue` | Batch size must be configurable (not fixed at 100/tick — confirm actual tick interval against real session volume before sizing); must scale via multiple instances/consumer group if backlog grows |
| Stale Scanner | Reads `active:sessions` ZSET via `ZRANGEBYSCORE`, never `SCAN` | Process in batches; throttle concurrent orchestrator calls (e.g. `p-limit`) to avoid a fan-out spike against ClickHouse/Redis/Postgres/ONNX when many sessions go stale simultaneously — this is the actual risk, not object-creation overhead. **Requirement on Enrichment's contract: `active:sessions` must be refreshed on every event type, including slow-path updates (`page_view`, `scroll_depth`), not only trigger events — otherwise a genuinely active session that isn't currently firing trigger events will be misclassified as stale.** |
| Budget Reconciliation | Compares Redis `budget:{store_id}:{date}` against PostgreSQL `daily_budget` | Every 15 minutes |
| Kafka/ClickHouse Reconciliation | Compares Kafka consumer offsets vs. ClickHouse ingested counts | Not yet implemented — required for detecting silent data loss |

Batch feature fetch: scheduler and stale scanner passes should fetch features for all due sessions in a single `WHERE user_id IN (...)` query, not one query per session.

---

## 6. Service Topology

**Decision:** single deployment, logical module separation. Not a physical service split.

- Risk Scoring module and Intervention module are separate code modules within one deployable, sharing Redis/Postgres/ClickHouse connections directly (in-process function calls, no network hop).
- Admin API reads risk data directly from Redis and proxies write actions (`recalculate`, `manual intervention`) to the Decision Engine over internal HTTP — this is the one legitimate network boundary in the system, and it must route through the same `tryAcquireLock` path as every other entry point (Section 4.2).
- **Do not extract Risk Scoring into a separate physical service on the current information.** The stated justification (admin dashboard needs risk visibility) is satisfied by exposing read endpoints on the existing service — see Section 7. A physical split adds a synchronous network dependency to the fast path specifically built to avoid one, and does not by itself fix any correctness issue in this document.
- **If a physical split is revisited later, it must be justified by measured throughput data** (not anticipated need) and must ship with, at minimum: a local-rules fallback in the Intervention Service for when the Risk Service is unreachable, a circuit breaker on the inter-service call, and a shadow-mode validation period comparing new-service scores against the existing scorer before cutover.

---

## 7. Admin API

### 7.1 Registration Flow — Corrected

The original flow held a PostgreSQL transaction open across two synchronous Kong HTTP calls. Corrected flow:

1. `BEGIN` → insert `stores` + `admin_users` → generate API key → update `stores.api_key_hash` → `COMMIT`. Store status: `provisioning`.
2. Call Kong (`POST /consumers`, `POST /consumers/{username}/key-auth`) **outside any open transaction.**
3. On Kong success: update store status to `active`.
4. On Kong failure after retries: mark `kong_provisioning_failed`, retry via background job, do not hold the original transaction open during retries.
5. **The API key is returned to the merchant once, at step 1's response.** If Kong provisioning fails after that point, there must be an explicit key-regeneration path — the merchant cannot re-request a key they already received but that never reached Kong. Not currently specified; required.

### 7.2 Access Control

- RBAC roles (`admin`, `viewer`, `analyst`, `super-admin`) as previously defined.
- **Every `store_id`-scoped endpoint** — not just `GET /admin/stores/{id}` — validates the requested `store_id` against `X-Store-IDs` via a single shared guard. This must be a cross-cutting rule enforced centrally, not an endpoint-by-endpoint implementation detail, or a future route will ship without the check.
- **Hard rule:** a missing or empty `X-Store-IDs` for a non-super-admin caller is an explicit `403`. It must never be interpreted as "no restriction = full access" — this is a classic allowlist/denylist confusion and must be enforced in the shared guard itself, not left to per-endpoint logic.
- **RESOLVED — JWT revocation, write endpoints only.** Include `token_version` in the JWT, stored on `admin_users`. Before processing any `admin`-role write, compare the JWT's `token_version` against the current value in PostgreSQL, with the current value cached in Redis (60s TTL) to avoid a DB hit per request. `viewer` reads accept the up-to-1-hour staleness window without this check.

### 7.3 Risk & Intervention Endpoints

- `GET /api/risk/active?store_id&limit&min_score` requires the `active_risk:{storeId}` sorted set (Section 2.1) to support real pagination and score filtering. The existing `active:sessions` set is scored by `last_activity`, not risk, and cannot serve this endpoint without an N+1 fetch-and-filter pattern.
- `POST /api/risk/recalculate/{userId}` is a Phase-1-only operation — does not require `lock:user`.
- `POST /api/intervention/manual` is a Phase-2 entry point — **must** acquire `lock:user` through the same `tryAcquireLock` path as automated interventions (Section 4.2). Must always respect the budget gate. Cooldown may be overridden only via an explicit `overrideCooldown: true` flag, always audit-logged.
- Proxy timeout to Decision Engine: 5s. If this timeout fires but the pipeline completes server-side, and the admin retries, the shared lock (which the manual path now uses) prevents a duplicate send.

### 7.4 Discount Code Validation (Customer-Facing)

- **RESOLVED — authenticated via the store's Kong API key**, not the admin JWT. Merchant checkout passes it in `X-API-Key`; Kong validates it with the `key-auth` plugin, the same pattern as `/v1/track`.
- Redemption must be atomic (`UPDATE ... WHERE used = false RETURNING *`) at the point of claim, not a separate validate-then-mark-used sequence — otherwise two concurrent checkouts can both pass validation on one single-use code.
- Needs a per-IP rate limit distinct from Kong's per-store limit — a single shopper enumerating codes against one store's shared quota can lock out other customers checking out at the same store.

### 7.5 Audit Logging

`audit_logs` records all admin write operations **and rejected privileged attempts** (e.g., a manual intervention blocked by `budget_exhausted`). Failed privileged attempts are frequently the more relevant signal for abuse investigation.

---

## 8. Failure Handling — Consolidated

| Component | Failure Mode | Handling |
|---|---|---|
| ONNX inference | Timeout (>50ms) or error | Fall back to rules; increment `onnx_fallback_total` |
| ONNX inference | 5 consecutive failures | Circuit breaker opens 5 min, skip ONNX entirely |
| Feature Service (ClickHouse) | Unavailable | Zero features, proceed, increment `degraded_features_total`; page on-call if >5% of decisions in 5 min are degraded |
| Redis cache miss (features) | — | Query ClickHouse with 200ms timeout; timeout → zero features |
| WebSocket outbound | >100ms | Fail over to notification-service |
| Email/SMS outbound | >2s | Enqueue for retry, exponential backoff, DLQ on exhaustion |
| `lock:user` acquisition | Failed | Skip this decision attempt; another entry point or the next scheduled pass will retry |
| Budget | Exhausted | Skip intervention, increment `decision_budget_exhausted_total` |
| Kafka message | Invalid JSON | Route to DLQ, continue batch |
| Kong (registration) | Unreachable / error | Retry with backoff outside the DB transaction; mark `kong_provisioning_failed` on exhaustion |
| Risk Scorer (if extracted in the future) | Unreachable | Local-rules fallback in Intervention Service; required precondition for any future physical split |

---

## 9. Observability Requirements

**Readiness probes must check real dependency state**, not return unconditional 200. Minimum checks: Kafka consumer joined to group, Redis reachable, ONNX model loaded (warn but don't fail readiness if rules-only mode is acceptable — confirm this is the intended behavior). The Admin API's existing `/ready` (checks DB/Redis/ClickHouse) is the reference implementation.

**Required metrics** (in addition to those already listed in the implementation doc): `degraded_features_total`, `onnx_fallback_total`, `decision_budget_exhausted_total`, `lock_acquire_failed_total`, escalation tier distribution, per-session weight distribution (for formula calibration).

**Required alerts:** degraded-feature rate >5% in 5 min; budget reconciliation drift between Redis and Postgres; lock heartbeat renewal failure rate.

---

## 10. Open Items — Status

Every item below is either **RESOLVED** (a concrete answer exists — implement it) or **OPEN** (no answer yet — do not build against an assumption). Follow-on build tasks created by a resolution are tracked in Section 11, not here.

| # | Item | Status | Answer / What's Missing |
|---|---|---|---|
| 1a | Who owns identity resolution and guest-cart merging | **RESOLVED** | Enrichment owns it. Decision Engine's contract: reject/DLQ any event missing `user_id` or `cart_id`. |
| 1b | How Enrichment actually performs the guest-cart merge | **OPEN** | No atomic, race-safe design exists yet. The Redis-only transaction pseudocode proposed for this doesn't give real atomicity, and nothing prevents two concurrent logins from double-merging the same cart. Needs: cart state moved to Postgres-source-of-truth/Redis-cache (like budget), plus a merge lock. |
| 2 | Weighted risk formula coefficient calibration | **OPEN** | Coefficients are hand-picked, unvalidated. A calibration process (shadow-mode logging + offline regression) is defined but has not been run. No answer exists until it runs against real traffic. |
| 3 | Escalation vs. fresh cooldown — same mechanism or separate? | **RESOLVED** | Two separate keys: `cooldown:{store_id}:{userId}` (blocks new episodes) and `escalation:{store_id}:{userId}` (tracks the active episode). They never gate each other. |
| 4 | Escalation discount value — rule-based or model-driven? | **RESOLVED** | Model-driven when confidence > 0.6 (using new `recommended_escalation_tier`/`recommended_value` model outputs), rule-based ladder otherwise. |
| 5 | Scheduler batch size / tick interval | **OPEN** | Starting defaults exist (200/tick, 1s, scale at 5,000 backlog) but are unvalidated guesses, not a tested answer. Needs staging load tests. |
| 6 | Kafka consumer throughput ceiling | **OPEN** | No expected peak trigger-event rate has been measured or estimated. Can't confirm `maxInFlightRequests: 1` is sufficient without it. |
| 7 | Retry/backoff logic vs. "orchestrator never throws" — contradiction | **RESOLVED** | Orchestrator returns a structured error instead of throwing. The outer Kafka consumer loop reads that error and decides retry vs. DLQ. |
| 8 | JWT revocation for privileged Admin API actions | **RESOLVED** | `token_version` field on `admin_users`, checked against the JWT claim on every `admin`-role write, cached in Redis (60s TTL) to avoid a DB hit per request. |
| 9 | Auth mechanism for the customer-facing discount validation endpoint | **RESOLVED** | Store's Kong API key via `X-API-Key` header, validated by Kong's `key-auth` plugin. |
| 10 | Budget decrement: at send time or redemption time? | **RESOLVED** | Send time, plus a reconciliation job that credits back unredeemed reservations once the discount code's TTL expires. |

**Two new OPEN items surfaced while resolving the above** (not decisions carried over — genuinely new, first identified in this round):

| # | Item | Status | What's Missing |
|---|---|---|---|
| 11 | Escalation episode termination | **OPEN** | No "dismiss offer" event exists in the tracker's schema. Until one is added, `escalation:{store_id}:{userId}` must carry its own TTL as the only thing bounding how long an escalation can run. |
| 12 | ONNX model output schema | **OPEN** | The model doesn't currently emit `recommended_escalation_tier` or `recommended_value` — required for Item 4's resolution to actually be implementable. This is a model training/schema task, not a routing decision. |

---

## 11. Implementation Priority

| Priority | Item |
|---|---|
| P0 | Design cart-state authority (Postgres source of truth + Redis cache) and merge locking for Enrichment's guest-cart merge (Open Items #1, #11, #12) |
| P0 | PostgreSQL as budget source of truth, Redis write-through, 15-min reconciliation job |
| P0 | Single-entry-point locking across all 5 entry points, Phase-2-only, with fencing token |
| P0 | Bound all outbound calls (100ms WS / 2s email-SMS / DLQ) |
| P0 | Fix Admin API registration transaction (commit before Kong call, async provisioning) |
| P0 | Feature-degradation alerting (>5% in 5 min) |
| P0 | Entry-point validation guard rejecting/DLQing events without `user_id` or `cart_id` |
| P1 | ONNX determines type/channel/value above confidence threshold, not just confidence |
| P1 | Real readiness probes (Kafka/Redis/ONNX state) |
| P1 | Scheduler actually drives re-evaluation from `eval:queue` (not bare TTL expiry) |
| P1 | Event-level idempotency (Bloom filter + `processed_events`), distinguished from session-level (`sent:user`) — checkpoint ordering fixed per Section 4.2 |
| P1 | `active_risk:{storeId}` sorted set for `GET /api/risk/active` |
| P1 | Universal store-scoping guard across all `store_id`-scoped Admin API endpoints, including explicit 403 on empty `X-Store-IDs` |
| P1 | Manual intervention routed through the same lock as automated paths |
| P1 | Atomic discount code redemption |
| P1 | Enrichment refreshes `active:sessions` on all event types, not only triggers |
| P1 | JWT `token_version` revocation check on `admin`-role writes |
| P2 | Pre-filter policy before ML (Section 4.3 step 1) |
| P2 | Batch feature fetch for scheduler/stale-scanner passes |
| P2 | Escalation tier hard cap; `escalation:{store_id}:{userId}` TTL safety net pending dismissal-event design (Open Item #13) |
| P2 | ONNX schema extension for `recommended_escalation_tier` / `recommended_value` (Open Item #14) |
| P2 | Purchase event cancels pending `eval:queue` entries and clears `escalation` key |
| P2 | Weighted risk formula: cap aggregate weight, log per-session breakdown for admin explainability |
| P2 | Discount validation endpoint: Kong API key auth + per-IP rate limit distinct from store-level Kong limit |
| P3 | Preload store policies on startup |
| P3 | Circuit breaker for ONNX (5 failures → 5 min open) |
| P3 | Behavioral event stream cap / client-side sampling confirmation |
| P3 | Run risk-formula shadow-mode calibration once in production (Open Item #2) |
| P3 | Validate scheduler batch size / tick interval against staging load tests (Open Item #5) |
| P3 | Measure actual peak trigger-event throughput to confirm `maxInFlightRequests: 1` is sufficient (Open Item #6) |
| Deferred | Physical Risk/Intervention service split — revisit only with measured throughput data, and only with local fallback + circuit breaker as a shipping requirement |