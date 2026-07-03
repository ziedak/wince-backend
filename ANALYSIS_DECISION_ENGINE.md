# Analysis: Decision Engine Implementation vs. Documentation

## Executive Summary

The implementation closely follows the documented architecture with excellent adherence to the two-phase design (Prediction + Intervention). However, there are several divergences, potential bugs, and missing features that should be addressed.

---

## 1. CRITICAL BUGS

### 1.1 Race Condition in Scheduler Worker
**File:** `scheduler/scheduler.worker.ts`
**Severity:** High

**Issue:** The `SchedulerWorker` processes sessions sequentially in a `for...of` loop without any bailing mechanism. If a session's `decide()` call hangs (e.g., ClickHouse timeout, ONNX model stall), the entire worker stalls.

```typescript
// Current (buggy)
for (const sessionId of sessionIds) {
  await this.processSession(sessionId); // No timeout, no parallelism
}
```

**Impact:** With a batch of 100 due sessions, one stuck session blocks the entire tick (1 second poll interval).

**Fix:** Add per-session timeout and/or process in parallel with `Promise.allSettled`:
```typescript
await Promise.allSettled(
  sessionIds.map(sid => this.processSessionWithTimeout(sid))
);
```

### 1.2 Missing Cart-Level Lock Check in Stale Scanner
**File:** `stale-scanner/stale-scanner.service.ts`
**Severity:** Medium

**Issue:** The `StaleScannerService` only checks `isSent()` before calling orchestrator, but doesn't acquire the cart lock for sessions with a cart_id. Multiple stale sessions from the same cart (e.g., multiple tabs abandoned) could each receive interventions.

**Current code (line 88-100):**
```typescript
if (await this.lock.isSent(sessionId)) return;
const ctx = await this.sessionFeatures.getSessionContext(sessionId);
// No cart lock acquisition here!
await this.orchestrator.decide(event);
```

**Impact:** Duplicate interventions for multi-tab users on the same cart.

**Fix:** Extract `cartId` and acquire cart lock (replicate logic from `intervention.service.ts:146-154`).

### 1.3 ONNX Input Placeholder Values May Cause Silent Failures
**File:** `inference/inference.service.ts`
**Severity:** Medium

**Issue:** The ONNX model input tensor uses two hardcoded zeros as placeholders (lines 67-71):
```typescript
const inputData = new Float32Array([
  features.abandonment_rate_7d,
  features.avg_cart_value_30d,
  0, // placeholder
  0, // placeholder
]);
```

If the ONNX model expects **non-zero** values for positions 2 and 3, the predictions will be silently garbage without any log. The current timeout (50ms) might mask this if the model runs fast with wrong inputs.

**Impact:** Model produces meaningless confidence scores, leading to incorrect intervention decisions.

**Fix:** Document expected input schema; validate model output against confidence bounds [0,1].

---

## 2. DIVERGENCES FROM DOCUMENTATION

### 2.1 Missing Mutable Session Features Update on Every Event
**Doc states:**
> Redis stores pre‑computed features for each session, **updated on every event**.

**Reality:** The `decision-engine` does NOT update session features. It only **reads** from `session:{sid}` hash (domain of `enrichment-session`). This is correct separation, but the doc implies the Decision Engine maintains this state.

**Impact:** None (architecturally correct), but documentation should clarify that **Enrichment Service** owns session state updates, not Decision Engine.

### 2.2 Active Sessions Sorted Set Maintenance
**Doc states:**
> ZADD active:sessions <timestamp> <session_id> on every event – for efficient stale session detection.

**Reality:** The `active:sessions` sorted set is also maintained by `enrichment-session` (not decision-engine). The stale-scanner only reads it. This is correct, but the doc should make the ownership explicit.

### 2.3 Intervention Pipeline Timing Overstated
**Doc states:**
> Total for sync path (WebSocket): ~15–20 ms (excluding network).

**Reality:** To achieve this, every step (Candidate Generator, Uplift Estimator, etc.) must complete in milliseconds. However, the implementation skips **Candidate Generator** and **Value Optimizer** - these are implicit in the `RuleEngine` and `DiscountService`.

The actual intervention path:
- Rules engine: < 0.1ms (pure computation)
- ONNX inference: 0–50ms (guarded)
- Discount code gen: < 5ms (Redis)
- DB insert + Kafka produce: ~5–20ms (blocking in current code!)
- Outbound WebSocket: ~100ms (hard timeout)

**Actual sync path: ~110–170ms** (excluding outbound network), primarily because the DB insert (line 184) and Kafka produce (line 63 of writer) are sequential blocking calls.

**Impact:** Latency is significantly higher than documented. The doc suggests "< 100ms fast path" is achievable, but the orchestrator's DB write blocks before WebSocket push.

### 2.4 No Batched Uplift Estimator / Value Optimizer
**Doc states:**
> Uplift Estimator — Batched Inference — one ONNX call for all candidates, not per‑candidate.

**Reality:** There is only **one intervention decision per event** (no candidate generation per se). The ONNX model predicts a single confidence score. There's no batch of candidates evaluated here. The user-facing `intervention` channel (in-shop vs off-shop) and specific type (discount, countdown) are determined by the RuleEngine, not a separate Uplift Estimator.

**Impact:** Not a bug, but the architecture is simplified vs. doc. The doc describes a richer multi-candidate system that doesn't exist in code.

---

## 3. OPTIMIZATIONS PRESENT BUT NOT DOCUMENTED

### 3.1 Fire-and-Forget Risk Score Write
**File:** `intervention.service.ts:119`
```typescript
void this.riskScorer.writeScore(sessionId, riskScore.score);
```

The risk score write to Redis is non-blocking (`void`). This is a great optimization because Redis write doesn't block the decision path. The doc mentions persistence but doesn't highlight the async pattern.

### 3.2 Deterministic Intervention ID via SHA-256
**File:** `intervention.service.ts:34-43`
```typescript
function deterministicInterventionId(eid: string, distinctId: string): string
```

Using SHA-256 of `{eid}|{distinctId}` ensures idempotent processing. Re-processing the same event generates the same `interventionId`, and the DB's unique constraint prevents duplicates. This is more robust than UUIDs and not explicitly mentioned in the doc.

### 3.3 Policy + Cooldown Gate Before Feature Fetch
**File:** `intervention.service.ts:98-106`

The orchestrator checks **policy** and **cooldown** before calling `features.getFeatures()`. This avoids an expensive ClickHouse query when the store has exhausted interventions or the customer is on cooldown.

**Doc doesn't mention this optimization**, which saves ~1-5ms per skipped event.

### 3.4 Retry with Exponential Backoff in Kafka Consumer
**File:** `kafka/decision.consumer.ts`

The consumer retries `decide()` with delays `[100, 200, 400]ms` - fast retries for transient failures. Not documented.

---

## 4. BUGS & EDGE CASES

### 4.1 Customer ID Null Handling May Skip Valid Sessions
**File:** `intervention.service.ts:89-92`

```typescript
if (customerId === null) {
  this.logger.debug(...);
  return;
}
```

If `customer_id` is null (e.g., anonymous session without mapping), the decision is skipped. The scheduler will retry if the session reappears. However, this means **no anonymous session ever gets interventions**, even if rules-based scoring could still serve them.

**Question:** Is this intentional? The doc doesn't mention this restriction.

### 4.2 Session State Freshening in Trigger Handler May Fail Silently
**File:** `trigger/trigger.handler.ts:62-77`

If `sessionFeatures.getSessionContext()` throws (Redis down), the catch block logs a warning and continues with the **original event payload**. The original event may have stale `cart_value` and `is_frustrated` from milliseconds ago.

**Impact:** During Redis partial outage, risk scores use stale data, potentially misrouting interventions.

### 4.3 Lock Service Fail-Open May Duplicate Interventions
**File:** `lock/lock.service.ts:39-41`

```typescript
} catch (err) {
  this.logger.warn(...);
  return true; // fail-open
}
```

All Redis errors return `true` (lock acquired). During a Redis network partition or memory pressure, the lock service will allow concurrent interventions for the same session/cart.

**Impact:** Duplicate pushes to gateway/notification. Breaks idempotency guarantees.

**Alternative:** Fail-closed (`return false`) with monitoring would be safer.

### 4.4 Intervention Writer DB Insert Failure Silently Continues
**File:** `intervention.writer.ts:32-57`

If the PostgreSQL INSERT fails, the error is logged but NOT thrown. The code proceeds to Kafka produce and outbound delivery. The intervention is sent but not recorded in the DB.

**Impact:** Audit gaps, billing discrepancies, missing experiment attribution.

**Fix:** Consider whether DB write failures should block delivery (fail-closed) or if eventual consistency is acceptable.

### 4.5 Scheduler Pop-Due Has Race Window
**File:** `scheduler/scheduler.service.ts:42-46`

```typescript
const members = await raw.zrangebyscore(EVAL_QUEUE_KEY, 0, now, 'LIMIT', 0, 100);
if (members.length === 0) return [];
await raw.zremrangebyscore(EVAL_QUEUE_KEY, 0, now);
```

If the process crashes between `zrangebyscore` and `zremrangebyscore`, the same sessions will be re-evaluated on restart. The session lock prevents duplicate interventions, but it's wasteful.

**Impact:** Minor — duplicate processing, but safe due to session lock.

---

## 5. MISSING FEATURES FROM DOC

### 5.1 No Candidate Generator Per-SE
The doc describes:
> Candidate Generator — List possible interventions (discount, free_shipping, urgency, email)

**Reality:** The `RuleEngine` in `rules.service.ts` returns a **single** best candidate. There's no multi-candidate generation + ranking step.

### 5.2 No Value Optimizer
The doc describes:
> Value Optimizer — Determine optimal value (e.g., discount %)

**Reality:** The discount value comes directly from `policy.discountValue` or hardcoded defaults. There's no optimization logic to determine the ideal discount percentage based on customer LTV, predicted uplift, etc.

### 5.3 Prometheus Metrics Mismatch
**Doc lists:**
- `risk_scores_distribution`
- `intervention_sent_total` (by type, channel)
- `pipeline_latency_seconds` (p95, p99)
- `lock_contention_rate`
- `kafka_consumer_lag`

**Reality:**
- `risk_scores_distribution` — **MISSING**. No histogram for risk score distribution.
- `intervention_total` — exists in `metrics.ts:14` with `{type, channel, variant}`
- `pipeline_latency_seconds` — **MISNAMED**. The metric is `decision_latency_ms` (histogram). No automatic p95/p99 labeling.
- `lock_contention_rate` — **MISSING**. No metric for session lock or cart lock failures.
- `kafka_consumer_lag` — partial: `decision_kafka_lag` exists but as gauge, not tracking lag over time.

### 5.4 No Graceful ONNX Model Degradation Metric
There's no metric tracking when ONNX inference fails/timeouts and falls back to rules. This makes it impossible to monitor model reliability.

### 5.5 No Redis Fallback to Kafka
**Doc states:**
> Redis outage — Read last known session state from Kafka (enriched event)

**Reality:** If Redis is down, `sessionFeatures.getSessionContext()` returns `null` (catch block), and the orchestrator bails. There's no fallback to consuming from Kafka's `enriched.events` topic in the Decision Consumer to rebuild session state.

---

## 6. ARCHITECTURAL CONCERNS

### 6.1 Blocking DB Write Before Outbound Delivery
**File:** `intervention.service.ts:184-226`

The PostgreSQL INSERT (`writer.write()`) is awaited **before** `outbound.route()`. If Postgres is slow, WebSocket push latency increases.

**Current order:**
1. DB INSERT
2. Kafka produce
3. WebSocket push

**Suggested:** DB insert + Kafka produce can happen in parallel with `void` (fire-and-forget), and outbound should not block on them. The `markDelivered()` can still confirm delivery later.

### 6.2 Single Redis Client Instance
All services share a single Redis client connection pool. Under high load (1000s of session reads per second), this could saturate. The doc mentions "separate logical DBs" but there's no `SELECT` command in the code.

### 6.3 No Circuit Breaker for External Dependencies
No circuit breakers exist for:
- ClickHouse (FeatureService)
- ONNX runtime (InferenceService)
- Postgres (InterventionWriter)

A sustained outage in any of these causes repeated retries and log spam.

---

## 7. SUMMARY TABLE

| Category | Issue | Severity | File | Lines |
|---|---|---|---|
| Bug | Scheduler worker stalls on stuck session | High | `scheduler.worker.ts` | 37-39 |
| Bug | Missing cart lock in stale scanner | Medium | `stale-scanner.service.ts` | 88-100 |
| Bug | ONNX placeholder inputs may produce garbage | Medium | `inference.service.ts` | 67-71 |
| Bug | Lock fail-open during Redis outage | Medium | `lock.service.ts` | 38-41 |
| Bug | DB insert failure silently continues | Medium | `intervention.writer.ts` | 52-57 |
| Bug | CustomerId null skips all anonymous sessions | Low | `intervention.service.ts` | 89-92 |
| Bug | Redis session freshening fallback uses stale data | Low | `trigger.handler.ts` | 62-77 |
| Divergence | No candidate generator / value optimizer | Medium | Multiple | N/A |
| Divergence | Actual latency ~110-170ms vs doc's <100ms | High | `intervention.service.ts` | 184-226 |
| Divergence | Missing Prometheus metrics (distribution, contention rate) | Low | `metrics.ts` | All |
| Missing | No fallback to Kafka for Redis outage | Medium | `session-features.service.ts` | 41-77 |
| Missing | No circuit breakers for ClickHouse, ONNX, Postgres | Low | Multiple | N/A |
| Optimization | Fire-and-forget risk score write | Positive | `intervention.service.ts` | 119 |
| Optimization | Deterministic intervention IDs via SHA-256 | Positive | `intervention.service.ts` | 34-43 |

---

## 8. RECOMMENDATIONS (Priority Order)

1. **P0:** Add per-session timeout in `SchedulerWorker.processSession()` to prevent batch stall.
2. **P0:** Add cart lock acquisition in `StaleScannerService.processStaleSession()`.
3. **P1:** Restructure `InterventionOrchestrator.decide()` to write DB + Kafka in parallel with outbound delivery (or after) to reduce latency.
4. **P1:** Add circuit breaker pattern for ClickHouse, ONNX, and Postgres.
5. **P1:** Implement missing Prometheus metrics (`risk_scores_distribution`, `lock_contention_rate`).
6. **P2:** Consider fail-closed for Redis lock acquisition (or at least emit alert).
7. **P2:** Add graceful Redis fallback by consuming from Kafka when Redis is unavailable.
8. **P3:** Update documentation to reflect simplified candidate/value optimizer architecture.
9. **P3:** Validate ONNX model inputs/outputs with explicit schema checks.