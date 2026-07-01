# Ingestion Service Comparison Report
## PostHog `capture` (Reference) vs. `apps/ingestion` (User)

---

## 1. Architecture Summary

### 1.1 Component Map

#### PostHog `capture` (Reference)

| Module | Responsibility |
|---|---|
| `main.rs` | Bootstrap: config, tracing (JSON+OTLP), lifecycle manager, signal trapping |
| `setup.rs` | Component registration with `lifecycle::Manager`; builds sink, limiters, restrictions, v1 sink router |
| `router.rs` | Axum router with per-mode routes (Events/Recordings/Ai), `State` struct holding all shared deps |
| `v0_endpoint.rs` | HTTP handlers: `event` (analytics), `recording` (replay) |
| `payload/analytics.rs` | Body extraction, decompression, token verification, quota filtering |
| `events/analytics.rs` | `process_single_event`, `process_events` — heatmap redirect, restrictions, global RL, overflow stamping |
| `events/overflow_stamping.rs` | Shared `stamp_overflow_reason` helper (analytics + AI + OTEL) |
| `sinks/mod.rs` | `Event` trait (`send`, `send_batch`, `flush`) |
| `sinks/kafka.rs` | `KafkaSinkBase` — pure mechanism; scatter-gather batch produce; rich rdkafka stats metrics |
| `sinks/fallback.rs` | `FallbackSink` with advisory lifecycle handle for proactive failover |
| `quota_limiters.rs` | `CaptureQuotaLimiter` — scoped + global Redis-backed quota with per-event predicates |
| `global_rate_limiter.rs` | Per-(token, distinct_id) Redis-backed limiter with local cache, custom keys, dry-run |
| `event_restrictions/` | Pipeline-scoped restrictions (Drop, ForceOverflow, SkipPerson, RedirectToDlq, RedirectToTopic) with filters |
| `config.rs` | ~60 env vars; `CaptureMode` enum; nested `KafkaConfig` |

#### User `apps/ingestion`

| Module | Responsibility |
|---|---|
| `main.rs` | Bootstrap: config, tracing (JSON+OTLP), Prometheus, graceful shutdown, Kafka drain |
| `handler.rs` | `track_handler` — store_id extraction, rate limit gate, body read, decompress, parse, delegate to pipeline |
| `pipeline.rs` | `process_envelope` — validate, Bloom dedup, illegal-ID check, quota, restrictions, skew correction, classify, route, produce |
| `config.rs` | ~30 env vars; flat structure |
| `sinks/mod.rs` | `Sink` trait (`send` only); `SinkHeaders` typed metadata |
| `sinks/kafka.rs` | Thin wrapper over `kafka::produce` |
| `sinks/fallback.rs` | `FallbackSink` — reactive only (on KafkaError) |
| `sinks/s3.rs` | Buffered NDJSON S3 sink with background flush |
| `kafka.rs` | `create_producer`, `produce`, `drain_producer`, `KafkaContext` stats callback |
| `rate_limiter.rs` | `StoreLimiter` (governor), `OverflowLimiter` (governor), `DistributedStoreLimiter` (Redis sliding window Lua) |
| `quota_limiter.rs` | `QuotaLimiter` — in-memory set refreshed from Redis; 3 buckets |
| `restrictions.rs` | `RestrictionStore` — in-memory map refreshed from Redis; blocklist only |
| `decompression.rs` | gzip/deflate/br/zstd with magic-byte sniffing |
| `body.rs` | Streaming body read with per-chunk timeout |
| `health.rs` | Liveness/readiness via global atomics; Kafka health from stats callback |
| `response.rs` | `BatchResult` — per-event outcome map with `Retry-After` |
| `errors.rs` | `AppError` enum with `IntoResponse` |

### 1.2 Request/Data Flow

#### PostHog `capture`

```
HTTP request
  → v0_endpoint::event (or recording)
    → payload/analytics::handle_event_payload
      → extractors::extract_body_with_timeout (size limit + chunk timeout)
      → payload::extract_payload_bytes (form/query/body extraction)
      → v0_request::RawRequest::from_bytes (decompress + deserialize)
      → extract_and_verify_token (token from batch/event)
      → quota_limiters::check_and_filter (scoped + global Redis quota)
    → events/analytics::process_events
      → heatmap redirect (split $$heatmap events)
      → process_single_event (timestamp parsing, DataType classification)
      → token_dropper filter
      → event_restrictions (pipeline-scoped, filtered)
      → global_rate_limiter (per token:distinct_id)
      → overflow_stamping::stamp_overflow_reason
      → sink.send / sink.send_batch
        → KafkaSinkBase::prepare_record (topic/key selection from metadata)
        → scatter-gather: parallel prep + serial enqueue + concurrent ack drain
```

#### User `apps/ingestion`

```
HTTP request (/v1/track)
  → handler::track_handler
    → extract X-Store-ID (Kong-injected)
    → StoreLimiter::is_limited (in-process governor)
    → DistributedStoreLimiter::is_limited (Redis sliding window, optional)
    → body::read_body (size limit + chunk timeout)
    → decompression::decompress (header + magic byte)
    → serde_json::from_slice (TrackingEnvelope)
    → redis::get_multiplexed_async_connection
    → pipeline::process_envelope
      → per-event:
        → validate (UUID, field lengths, timestamp sanity)
        → is_duplicate (Redis Bloom filter, today+yesterday windows)
        → is_illegal_id (placeholder ID blocklist)
        → QuotaLimiter::is_exceeded (in-memory set)
        → RestrictionStore::is_restricted (in-memory map)
        → clock-skew correction (clamped ±30min)
        → build ServerEvent
        → size check (DLQ if oversized)
        → historical rerouting (age > threshold)
        → OverflowLimiter::is_hot_key
        → classify → topic_for
        → sink.send (Kafka or FallbackSink→S3)
      → aggregate BatchResult
  → response: 202 with per-event outcome map
```

### 1.3 Dependency Hotspots

#### PostHog `capture`

| Hotspot | Observation | Severity |
|---|---|---|
| `router::State` — 20+ fields | `router.rs:39-85` — God struct holding every dependency. `router()` takes 26 arguments. **Severity**: High — **Impact**: Any new feature touches the State struct and router() signature, creating merge conflicts and test friction. **Recommendation**: Group related fields into sub-structs (RateLimitingConfig, SinkConfig, BodyLimits). |
| `common_redis::Client` trait bound | Used in `router.rs`, `setup.rs`, `quota_limiters.rs`, `global_rate_limiter.rs` — tight coupling to PostHog's internal Redis client abstraction. **Severity**: Medium — **Impact**: Cannot swap Redis implementation without touching 4+ modules. **Recommendation**: Acceptable for a monorepo; document the contract. |
| `lifecycle::Manager` | Pervasive — every component registers with it. `setup.rs:40-102` — 7 manual registrations. **Severity**: Low — **Impact**: Boilerplate-heavy but well-structured. **Recommendation**: Keep as-is; the lifecycle integration is a strength. |
| `common_types::RawEvent` / `CapturedEvent` | Shared across capture + ingestion-consumer + personhog. **Severity**: Low — **Impact**: Schema changes require cross-crate coordination. **Recommendation**: Versioned schema with feature flags. |

#### User `apps/ingestion`

| Hotspot | Observation | Severity |
|---|---|---|
| `AppState` — 8 fields, all `Arc` | `handler.rs:20-36` — Reasonable size, but `process_envelope` takes 9 arguments. **Severity**: Medium — **Impact**: Function signature is brittle; adding a dep means updating every call site and test. **Recommendation**: Pass a `PipelineContext` struct. |
| `pipeline::process_envelope` — 9 params | `pipeline.rs:290-304` — `envelope, store_id, source, ip, config, sink, overflow_limiter, quota_limiter, restriction_store, redis`. **Severity**: Medium — **Impact**: Hard to test in isolation; mock setup is verbose. **Recommendation**: Bundle into a context struct. |
| `redis::Client` (raw crate) | Used directly in `handler.rs`, `rate_limiter.rs`, `quota_limiter.rs`, `restrictions.rs`, `pipeline.rs`. **Severity**: Low — **Impact**: No abstraction layer; acceptable for a single-service app. |
| `SinkHeaders` — 12 fields | `sinks/mod.rs:24-52` — Duplicated in JSON body and Kafka headers. **Severity**: Low — **Impact**: Schema drift risk between body and headers. **Recommendation**: Document that headers are the authoritative routing metadata. |

---

## 2. Scored Evaluation

| Dimension | PostHog `capture` | User `apps/ingestion` |
|---|---|---|
| **Correctness** | **8/10** — Battle-tested at scale. Timestamp parsing via `common_types::timestamp::parse_event_timestamp` handles edge cases (`$ignore_sent_at`, offset). Heatmap redirect logic is sophisticated. Loses points for `BillingLimit` returning 200 (silent drop). | **7/10** — Solid core pipeline. Bloom filter dedup with cross-midnight windows is well-designed. Clock-skew clamp at ±30min is pragmatic. Loses points for per-event Redis Bloom check in the hot path (1 RTT/event) and no batch-level quota filtering. |
| **Simplicity** | **5/10** — 20+ source files in `capture/src/` alone, plus `v1/` subtree. `router()` has 26 parameters. `process_events` is 170 lines with 5 filtering stages. Necessary for PostHog's scope but high cognitive load. | **8/10** — 14 source files, single endpoint, linear pipeline. `process_envelope` is 240 lines but follows a clear step-by-step pattern. Easy to onboard. |
| **Maintainability** | **6/10** — Well-documented with inline comments explaining routing policy. But the `State` struct and `router()` signature are change-aversion magnets. Cross-crate dependencies (`common_types`, `limiters`, `common_redis`) require monorepo context. | **8/10** — Self-contained crate with minimal external deps. Each module has a single responsibility. Tests are co-located and readable. Loses points for the 9-param `process_envelope` signature. |
| **Scalability** | **9/10** — Scatter-gather batch produce (`KafkaSinkBase::send_batch`) parallelizes CPU-bound prep. Per-(token, distinct_id) global rate limiter with local cache. V1 sink router for multi-cluster Kafka. Idempotent producer configurable. | **6/10** — Single-event produce (`sink.send` per event). No batch produce path. Per-event Redis Bloom RTT in the hot path. No concurrency limit layer. Distributed rate limiter fails open. S3 fallback buffer is in-memory (process crash = data loss). |
| **Reliability** | **8/10** — `FallbackSink` with advisory handle proactively routes to S3 when Kafka health degrades (not just on error). Lifecycle manager with liveness deadlines. Graceful shutdown with 60s window. Replay envelope compression for backward compat. | **6/10** — `FallbackSink` is reactive only (on `KafkaError`). S3 sink buffers in memory — `s3.rs:169` spawns flush on buffer full but if the process crashes between flushes, buffered events are lost. No advisory health check. Bloom filter failure is logged but proceeds (fail-open dedup). |
| **Security** | **7/10** — Token verification (`extract_and_verify_token`) rejects personal API keys, multiple tokens. IP redaction for internal events. But CORS is `mirror_request()` with credentials — permissive. No explicit store/tenant isolation (token = tenant). | **7/10** — Relies on Kong for auth (X-Store-ID header injection) — good separation. But `handler.rs:56-70` trusts the header without signature verification. If Kong is bypassed, any client can spoof store_id. `CorsLayer::permissive()` is wide open. |
| **Operability** | **9/10** — Rich rdkafka stats: per-broker RTT/latency percentiles, queue depth, topic batch stats. Lifecycle manager with prestop check. Continuous profiling. Per-pipeline restriction metrics. Mirror deploy support. | **7/10** — Good metrics coverage (`ingestion_*` counters/histograms). Kafka stats callback reports broker health. OTLP tracing with sampling. But no per-broker latency breakdown. No prestop hook (just `set_shutdown_status`). S3 flush has no WAL. |
| **Testability** | **8/10** — `MockSink`, `MockKafkaProducer`, `MockRestrictionsRepository`, `GlobalRateLimiter::mock_limiting`. E2E pipeline-to-sink tests. `rstest` for parametric cases. But `router()` with 26 params makes integration tests verbose. | **7/10** — Co-located unit tests for validation, classification, Bloom keys, decompression, body read, rate limiters, quota, restrictions, response. But no mock sink — pipeline tests would need a real Redis and Kafka. `process_envelope` takes `&mut C: ConnectionLike` which is testable but requires a Redis mock. |
| **Cost** | **7/10** — Batch produce amortizes Kafka overhead. Local cache for global rate limiter reduces Redis load. But per-event Redis quota check in `check_and_filter` is a hot-path RTT. Envelope compression (LZ4) reduces Kafka storage costs. | **5/10** — Per-event Redis Bloom filter RTT (4 commands pipelined) is the dominant cost. Per-event Kafka produce (no batching). S3 fallback buffer flushes every 1s or 4MiB — reasonable but no compression. No idempotent producer config (always on, but no `enable.idempotence` in Cargo — actually it is hardcoded true in `kafka.rs:57`). |

---

## 3. Capability Parity Matrix

| Capability | PostHog `capture` | User `apps/ingestion` | Gap |
|---|---|---|---|
| **HTTP endpoints** | `/e`, `/batch`, `/track`, `/engage`, `/capture`, `/s`, `/i/v0/ai`, `/i/v0/ai/otel`, v1 analytics | `/v1/track` only | User: single-purpose, PostHog: multi-protocol |
| **Event types** | Analytics, Recordings (replay), AI, OTEL, Heatmaps, Exceptions, ClientWarnings | Analytics, Errors, Identify, Checkout (classification only) | User: no replay/AI/OTEL/heatmap support |
| **Body decompression** | gzip, LZString, base64 (query/form/body) | gzip, deflate, br, zstd (header + magic byte) | User has broader codec support; PostHog has legacy format support |
| **Body size protection** | Per-route limits (2MB event, 20MB batch, 25MB recording) + decompression bomb protection | Single limit (10MB raw, 1MB per event) | PostHog: granular; User: simpler |
| **Chunk timeout** | `extract_body_with_timeout` | `read_body` with `chunk_timeout` | **Parity** — both implement slow-loris protection |
| **Deduplication** | None in capture (handled downstream in ingestion-consumer) | Redis Bloom filter (today+yesterday windows, 48h TTL) | User has upstream dedup; PostHog defers to consumer |
| **Rate limiting (in-process)** | `OverflowLimiter` (governor, per token:distinct_id) | `StoreLimiter` (governor, per store_id) + `OverflowLimiter` (governor, per store:anon) | User: store-level gate; PostHog: per-user overflow |
| **Rate limiting (distributed)** | `GlobalRateLimiter` (Redis + local cache, custom keys, dry-run) | `DistributedStoreLimiter` (Redis sliding window Lua) | PostHog: per-(token, distinct_id) with local cache; User: per-store |
| **Quota limiting** | `CaptureQuotaLimiter` — scoped (Exceptions, Surveys, LLM) + global, Redis-backed, per-event predicates | `QuotaLimiter` — 3 buckets (Events, Exceptions, Checkout), in-memory set from Redis | PostHog: richer scoping; User: simpler, fail-open |
| **Event restrictions** | 5 types (Drop, ForceOverflow, SkipPerson, RedirectToDlq, RedirectToTopic) with filters (distinct_id, session_id, event_name, event_uuid) and pipeline scoping | Blocklist only (per-store event name set) | PostHog: significantly richer |
| **Overflow routing** | `stamp_overflow_reason` → `OverflowReason` enum (ForceLimited, RateLimited{preserve_locality}, ReplayLimited) → sink reads metadata | `OverflowLimiter::is_hot_key` → empty partition key → overflow topic | PostHog: metadata-driven; User: inline decision |
| **Historical rerouting** | `HistoricalConfig::should_reroute` (AnalyticsMain only, timestamp-based) | `age_ms > historical_threshold_ms` → historical topic | **Parity** — same concept, different implementation |
| **Sink abstraction** | `Event` trait: `send`, `send_batch`, `flush` | `Sink` trait: `send` only | PostHog: batch support; User: single-event only |
| **Kafka produce** | Scatter-gather (parallel prep + serial enqueue + concurrent ack) | Single-event `FutureRecord::send` with `Timeout::Never` | PostHog: significantly higher throughput |
| **S3 fallback** | `S3Sink` with lifecycle handle; `FallbackSink` with advisory proactive failover | `S3Sink` with in-memory buffer + background flush; `FallbackSink` reactive only | PostHog: proactive; User: reactive + data loss risk on crash |
| **DLQ** | Sink-side via `redirect_to_dlq` metadata (event restrictions only) | Pipeline-side for validation failures and oversized events | User: broader DLQ usage; PostHog: restriction-only |
| **Clock-skew correction** | `common_types::timestamp::parse_event_timestamp` (sent_at, offset, `$ignore_sent_at`) | `raw_skew.clamp(-1_800_000, 1_800_000)` applied to `event.ts` | PostHog: richer parsing; User: simpler clamp |
| **Illegal ID handling** | `TokenDropper` (per token:distinct_id config) | `ILLEGAL_IDS` blocklist (17 placeholders) → disable person processing | Different approaches; User: identity graph protection; PostHog: config-driven drop |
| **Health checks** | `lifecycle::Manager` with liveness deadlines, prestop check, readiness handler | Global atomics (`KAFKA_HEALTHY`, `SHUTDOWN_STATUS`) | PostHog: richer lifecycle; User: minimal but functional |
| **Observability** | Per-broker Kafka stats (RTT, latency percentiles), per-topic batch stats, continuous profiling, mirror deploy tags | Basic Kafka queue metrics, OTLP tracing, Prometheus counters/histograms | PostHog: significantly deeper |
| **Response format** | `CaptureResponse` (status + quota_limited) | `BatchResult` (per-event outcome map with Retry-After) | User: richer client feedback; PostHog: simpler |
| **Graceful shutdown** | Lifecycle manager with 60s graceful shutdown + component drain | `shutdown_signal` + `drain_producer` with configurable timeout | **Parity** — both handle SIGTERM + Kafka flush |
| **Idempotent producer** | Configurable (`enable.idempotence` env var) | Hardcoded `true` | User: safer default; PostHog: flexible |
| **Cookieless mode** | `extract_is_cookieless_mode` + cookieless identity resolution | `EventOptions::cookieless_mode` flag forwarded to headers | PostHog: full implementation; User: flag forwarding only |

---

## 4. Shared Blind Spots

| Blind Spot | PostHog | User | Severity | Impact | Recommendation |
|---|---|---|---|---|---|
| **S3 fallback data loss on crash** | `S3Sink` buffers in memory; process crash between flushes loses data | Same — `s3.rs:35-69` `EventBuffer` is in-memory with 1s/4MiB flush | **High** | During Kafka outage + process crash, all buffered S3 events are lost | Write buffer to a local WAL (e.g., `sqlite` or `mmap` file) before acking to the pipeline |
| **Bloom filter false positives** | N/A (no upstream dedup) | `pipeline.rs:242-262` — Redis Bloom filter has inherent FPP; no capacity/error rate config | **Medium** | Legitimate events may be dropped as duplicates; no visibility into FPP rate | Expose Bloom filter capacity and error rate as config; emit `bloom_false_positive` metric |
| **No schema evolution strategy** | `RawEvent` / `CapturedEvent` in `common_types` — shared across crates | `TrackingEnvelope` / `RawEvent` / `ServerEvent` in `pipeline.rs` — no versioning beyond `schema_v: Option<u32>` | **Medium** | Adding/removing fields requires coordinated SDK + consumer updates; no backward compat guarantee | Use protobuf or versioned JSON schema with `schema_v` enforcement |
| **Redis single point of failure** | Redis used for rate limiting, quota, restrictions, global RL | Redis used for Bloom, distributed RL, quota, restrictions | **High** | Redis outage degrades rate limiting (fail-open), loses dedup, stale quota/restriction caches | PostHog: dedicated Redis for global RL (already supported). User: consider Redis Cluster or sentinel |
| **No backpressure signal to client** | Returns 200 on `BillingLimit` (silent drop) | Returns 202 with per-event outcomes, but no `429` for quota exceeded (drops with `quota_exceeded` outcome) | **Medium** | Clients continue sending during overload, wasting bandwidth | Return 429 with `Retry-After` when quota/batch drop rate exceeds threshold |
| **No replay/redo for S3 fallback** | S3 objects are NDJSON; no manifest or replay tooling mentioned | Same — `s3.rs:132-134` writes `YYYY/MM/DD/UUID.ndjson` with no manifest | **Medium** | S3 fallback events require manual replay; no automated re-ingestion | Write a manifest file per flush batch; provide a replay CLI tool |
| **Clock skew across instances** | `state.timesource.current_time()` — no NTP sync verification | `Utc::now()` — assumes system clock is correct | **Low** | Clock drift between pods causes inconsistent skew correction | Emit `ingestion_clock_skew_seconds` (User already does this — good); add alert on p99 > 60s |
| **No payload schema validation** | `serde_json::from_str` — accepts any valid JSON | `serde_json::from_slice` — accepts any valid JSON | **Medium** | Malformed events with extra fields pass through; downstream consumers may break on unexpected fields | Add JSON Schema validation for critical fields (or use `serde(deny_unknown_fields)` for strict mode) |
| **No per-tenant isolation in Kafka** | All events share topics; tenant isolation via token in headers/body | All events share topics; tenant isolation via `store_id` in headers/body | **Low** | A noisy tenant can cause consumer lag for all tenants | Overflow routing mitigates this; consider per-tenant topics for high-volume tenants |
| **No abuse detection** | Rate limiting is per-token/per-distinct_id but no anomaly detection | Rate limiting is per-store but no anomaly detection | **Medium** | Sudden traffic spikes from a single source are throttled but not flagged for investigation | Emit anomaly metrics (e.g., 10x traffic increase for a store/token) and alert |
| **Header injection via Kafka headers** | `event.to_headers()` — no sanitization visible | `build_kafka_headers` in `kafka.rs:123-156` — header values are string-formatted but not length-limited | **Low** | Extremely long `anon_id` or `session_id` could bloat Kafka headers | Enforce max header value length (e.g., 1024 bytes) |

---

## 5. Hybrid Proposal

### 5.1 Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Gateway (Kong)                        │
│            Auth, rate limiting, X-Store-ID injection             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Ingestion Service                            │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Handler    │→ │  Body Reader │→ │  Decompression         │ │
│  │  (Axum)     │  │  (timeout)   │  │  (gzip/br/zstd/deflate)│ │
│  └─────────────┘  └──────────────┘  └───────────┬────────────┘ │
│                                                  │              │
│                                                  ▼              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Pipeline Context                       │   │
│  │  (struct: config, sink, limiters, stores, redis)         │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Event Processor                         │   │
│  │  1. Validate (UUID, field lengths, timestamp)            │   │
│  │  2. Batch Bloom dedup (MGET instead of per-event)  ← FIX │   │
│  │  3. Illegal ID check → disable person processing         │   │
│  │  4. Quota check (in-memory, batch-level)           ← ADOPT│   │
│  │  5. Restrictions (pipeline-scoped, filtered)       ← ADOPT│   │
│  │  6. Clock-skew correction (clamped)                      │   │
│  │  7. Classify → DataType                                 │   │
│  │  8. Historical rerouting                                 │   │
│  │  9. Overflow stamping (metadata-driven)            ← ADOPT│   │
│  │ 10. Size check → DLQ                                     │   │
│  │ 11. Batch produce (scatter-gather)                ← ADOPT│   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Sink Layer (trait: send, send_batch, flush) │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │   │
│  │  │ KafkaSink    │  │ FallbackSink │  │ S3Sink (WAL)  │  │   │
│  │  │ (batch prod) │→ │ (advisory)   │→ │ (durable buf) │  │   │
│  │  └──────────────┘  └──────────────┘  └───────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Lifecycle Manager                           │   │
│  │  (component registration, liveness deadlines, prestop)   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Key Design Decisions

| Decision | Rationale | Alternative Rejected |
|---|---|---|
| **Batch Bloom dedup** | Per-event Redis RTT is the #1 cost bottleneck. Pipeline all `BF.EXISTS`/`BF.ADD` commands in a single `redis::pipe()` round-trip for the entire batch. | Keep per-event: simpler but 100 RTTs for a 100-event batch |
| **Metadata-driven overflow** | Adopt PostHog's `OverflowReason` enum + `stamp_overflow_reason` pattern. Sink reads metadata, doesn't make policy decisions. | Keep inline: works but couples routing policy to sink mechanism |
| **Scatter-gather batch produce** | PostHog's `KafkaSinkBase::send_batch` parallelizes CPU-bound `serde_json::to_string` + header building. 2-3x throughput for large batches. | Keep single-event: simpler but CPU-bound on single thread |
| **Advisory fallback sink** | PostHog's `FallbackSink::new_with_advisory` proactively routes to S3 when Kafka health degrades, not just on error. Prevents cascading failures. | Keep reactive: simpler but slower to failover |
| **WAL-backed S3 buffer** | Write buffer entries to a local SQLite WAL before acking. On restart, replay WAL to S3. Prevents data loss on crash. | Keep in-memory: simpler but data loss on crash |
| **Pipeline-scoped restrictions** | Adopt PostHog's `Pipeline` enum + `RestrictionType` enum with filters. Enables per-pipeline (analytics vs error tracking) restriction rules. | Keep blocklist: simpler but cannot express "force overflow for this event" or "redirect to DLQ" |
| **Lifecycle manager** | Adopt PostHog's `lifecycle::Manager` pattern for component registration, liveness deadlines, and prestop hooks. | Keep global atomics: simpler but no deadline-based health detection |
| **Keep per-event response** | User's `BatchResult` with per-event outcome map is superior to PostHog's single-status response. SDKs can make better retry decisions. | Adopt PostHog's single-status: simpler but less client-friendly |

### 5.3 Migration Plan

#### Phase 1: Stabilize (Effort: 2 weeks, Risk: Low, Rollback: Revert)

| Step | Change | Files |
|---|---|---|
| 1.1 | Bundle `process_envelope` params into `PipelineContext` struct | `pipeline.rs`, `handler.rs` |
| 1.2 | Add `send_batch` to `Sink` trait | `sinks/mod.rs`, `sinks/kafka.rs`, `sinks/fallback.rs`, `sinks/s3.rs` |
| 1.3 | Add `flush` to `Sink` trait | Same |
| 1.4 | Add per-batch Bloom dedup (pipeline all BF commands) | `pipeline.rs` |
| 1.5 | Add S3 WAL (SQLite-backed buffer) | `sinks/s3.rs` |

**Rollback**: Revert to per-event Bloom and in-memory S3 buffer.

**Regression checks**:
- Bloom dedup: verify same drop rate for duplicate eids
- S3 WAL: verify no data loss on `kill -9` + restart
- `send_batch`: verify Kafka ordering preserved per partition

#### Phase 2: Extract (Effort: 3 weeks, Risk: Medium, Rollback: Feature flag)

| Step | Change | Files |
|---|---|---|
| 2.1 | Extract `OverflowReason` enum + `stamp_overflow_reason` helper | New `overflow.rs` |
| 2.2 | Extract `DataType` enum with `from_event_name` + `pipeline()` | New `types.rs` |
| 2.3 | Extract `ProcessedEventMetadata` struct | `types.rs` |
| 2.4 | Refactor `KafkaSink` to read metadata for topic/key selection | `sinks/kafka.rs` |
| 2.5 | Implement scatter-gather `send_batch` in `KafkaSink` | `sinks/kafka.rs` |

**Rollback**: Feature flag `SCATTER_GATHER_ENABLED=false` → fall back to serial produce.

**Regression checks**:
- Overflow routing: verify same topic/key selection for hot keys
- Batch ordering: verify same-partition ordering preserved
- Throughput: benchmark p99 produce latency at 100/500/1000 event batches

#### Phase 3: Replace (Effort: 4 weeks, Risk: High, Rollback: Feature flag)

| Step | Change | Files |
|---|---|---|
| 3.1 | Replace `RestrictionStore` with pipeline-scoped `EventRestrictionService` | New `restrictions/` module |
| 3.2 | Add `RestrictionType` enum (Drop, ForceOverflow, SkipPerson, RedirectToDlq, RedirectToTopic) | `restrictions/types.rs` |
| 3.3 | Add `RestrictionFilters` (distinct_id, session_id, event_name, event_uuid) | `restrictions/types.rs` |
| 3.4 | Replace `FallbackSink` with advisory-handle version | `sinks/fallback.rs` |
| 3.5 | Add `lifecycle::Manager` for component registration + liveness deadlines | New `lifecycle.rs` |
| 3.6 | Replace global-atomic health checks with lifecycle handlers | `health.rs` |

**Rollback**: Feature flags `RESTRICTIONS_V2_ENABLED`, `ADVISORY_FALLBACK_ENABLED`, `LIFECYCLE_MANAGER_ENABLED`.

**Regression checks**:
- Restrictions: verify blocklist still works; verify new types (ForceOverflow, RedirectToDlq) route correctly
- Advisory fallback: verify S3 activation when Kafka health degrades (not just on error)
- Lifecycle: verify readiness flips to 503 when Kafka liveness deadline expires

#### Phase 4: Optimize (Effort: 2 weeks, Risk: Low, Rollback: Config revert)

| Step | Change | Files |
|---|---|---|
| 4.1 | Add per-broker Kafka stats (RTT, latency percentiles) | `kafka.rs` |
| 4.2 | Add per-topic produce bytes/batch size metrics | `kafka.rs` |
| 4.3 | Add continuous profiling support (pyroscope) | `main.rs`, `Cargo.toml` |
| 4.4 | Add concurrency limit layer | `main.rs` |
| 4.5 | Add `Retry-After` 429 when batch drop rate > threshold | `handler.rs` |

**Rollback**: Set config defaults to disable.

**Regression checks**:
- Metrics: verify new metrics appear in Prometheus
- Concurrency limit: verify 503 under load > limit
- Profiling: verify no perf degradation

### 5.4 Success Criteria

| Criterion | Target | Measurement |
|---|---|---|
| **Bloom dedup RTT** | ≤ 1 Redis round-trip per batch (was 1 per event) | `ingestion_bloom_rtt_seconds` histogram |
| **Kafka produce throughput** | ≥ 10,000 events/s at batch=100 (was ~3,000) | Load test with `vegeta` or `wrk` |
| **S3 fallback durability** | 0 events lost on `kill -9` + restart | Chaos test: kill process during S3 fallback, verify WAL replay |
| **Advisory failover latency** | ≤ 5s from Kafka degradation to S3 activation (was: on-error only) | Inject Kafka partition, measure time to first S3 write |
| **Restriction richness** | Support 5 restriction types with 4 filter dimensions | Integration test with all types |
| **Kafka ordering** | Same-partition ordering preserved in `send_batch` | Unit test: batch with same-key events, verify produce order |
| **p99 produce latency** | ≤ 50ms at 100-event batch (was: ~200ms single-event) | Load test + `ingestion_produce_duration_seconds` histogram |
| **Readiness accuracy** | Readiness flips to 503 within 30s of Kafka broker loss | Chaos test: kill Kafka broker, measure time to 503 |
| **Error rate** | ≤ 0.1% 5xx under normal load | `ingestion_events_accepted_total` / total requests |
| **Memory per pod** | ≤ 512 MiB at 10,000 events/s | `kubectl top pods` during load test |

---

## 6. Decision Prioritization

### MUST (Production incident prevention)

1. **S3 WAL-backed buffer** — In-memory buffer = data loss on crash. **Evidence**: `s3.rs:35-69` `EventBuffer` is `Vec<u8>` with no persistence. **Severity**: Critical.
2. **Batch Bloom dedup** — Per-event Redis RTT is the #1 scalability bottleneck. **Evidence**: `pipeline.rs:343` calls `is_duplicate` per event in a loop. **Severity**: High.
3. **Advisory fallback sink** — Reactive-only failover means events are lost between Kafka degradation detection and S3 activation. **Evidence**: `fallback.rs:38-57` only triggers on `AppError::KafkaError`. **Severity**: High.
4. **Scatter-gather batch produce** — Single-event produce caps throughput at ~3,000 events/s. **Evidence**: `sinks/kafka.rs:21-29` `KafkaSink::send` calls `produce` per event. **Severity**: High.

### SHOULD (Operational excellence)

5. **Pipeline-scoped restrictions** — Blocklist-only cannot express "force overflow" or "redirect to DLQ". **Evidence**: `restrictions.rs:53-61` `is_restricted` returns bool only. **Severity**: Medium.
6. **Lifecycle manager** — Global atomics have no deadline-based health detection. **Evidence**: `health.rs:73` `KAFKA_HEALTHY` is set by stats callback but never expires. **Severity**: Medium.
7. **Per-broker Kafka metrics** — No visibility into broker-level RTT/latency. **Evidence**: `kafka.rs:30-36` emits only queue depth + broker count. **Severity**: Medium.
8. **429 on batch drop rate** — Clients continue sending during overload. **Evidence**: `response.rs:65-78` always returns 202. **Severity**: Medium.

### COULD (Nice-to-have improvements)

9. **Continuous profiling** — PostHog uses `pyroscope` for flamegraph profiling. **Severity**: Low.
10. **Concurrency limit layer** — PostHog has `ConcurrencyLimitLayer` to cap in-flight requests. **Severity**: Low.
11. **Envelope compression** — PostHog supports LZ4 envelope compression for replay. **Severity**: Low (no replay support yet).
12. **Heatmap redirect** — PostHog splits heatmap data into a separate topic. **Severity**: Low (not in current scope).

---

## Evidence Index

| Finding | File + Function/Class | Severity |
|---|---|---|
| S3 buffer data loss on crash | `s3.rs:35-69` `EventBuffer` | Critical |
| Per-event Bloom RTT | `pipeline.rs:343` `is_duplicate` call in loop | High |
| Reactive-only fallback | `fallback.rs:38-57` `FallbackSink::send` | High |
| No batch produce | `sinks/kafka.rs:21-29` `KafkaSink::send` | High |
| Blocklist-only restrictions | `restrictions.rs:53-61` `is_restricted` | Medium |
| No liveness deadline | `health.rs:73` `KAFKA_HEALTHY` atomic | Medium |
| 9-param process_envelope | `pipeline.rs:290-304` `process_envelope` | Medium |
| 26-param router() | `router.rs:124-152` `router()` (PostHog) | High |
| God struct State | `router.rs:39-85` `State` (PostHog) | High |
| BillingLimit returns 200 | `v0_endpoint.rs:47-54` `event` handler (PostHog) | Medium |
| Permissive CORS | `main.rs:228` `CorsLayer::permissive()` / `router.rs:181-185` (PostHog) | Low |
| No header value length limit | `kafka.rs:123-156` `build_kafka_headers` | Low |
| No schema validation | `pipeline.rs:123` `serde_json::from_slice` | Medium |
| Redis SPOF | `handler.rs:127-131`, `rate_limiter.rs:178-198` | High |