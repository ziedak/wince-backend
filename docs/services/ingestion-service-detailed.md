# Ingestion Service — Detailed Documentation
TODO
Kafka retry.admin is appropriate for /v1/track high-volume ingestion — not here
## Overview

The Ingestion Service is a high-performance Rust (Axum) service that serves as the primary event ingestion endpoint for the WiNCE analytics platform. It accepts batched tracking events from browser SDKs and backend systems (e.g., WooCommerce), applies server-side enrichment and validation, and publishes events to Kafka for downstream processing.

**Key characteristics:**
- **Language & Framework:** Rust 2021, Axum 0.7, Tokio
- **Default Port:** 3001
- **Primary Input:** `POST /v1/track` with JSON-encoded `TrackingEnvelope`
- **Primary Output:** Kafka topics (`raw.events`, `error.events`, `identify.events`, `checkout.events`, `overflow.events`, `historical.events`, `dlq.events`)
- **Fallback Output:** S3 (optional, via S3 fallback sink with WAL durability)
- **Stateless:** Aside from ephemeral rate-limiter state and background cache refresh loops

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client / SDK                         │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS (optionally compressed)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Kong API Gateway                        │
│  (auth, X-Store-ID injection, rate limiting, IP forwarding) │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Ingestion Service                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Handler    │─▶│   Pipeline   │─▶│      Sink        │  │
│  │ (track.rs)  │  │ (pipeline.rs)│  │ (sinks/*.rs)     │  │
│  └─────────────┘  └──────────────┘  └──────────────────┘  │
│         │                 │                    │            │
│         ▼                 ▼                    ▼            │
│  ┌────────────┐   ┌─────────────┐   ┌──────────────┐       │
│  │   Redis    │   │   Kafka     │   │     S3       │       │
│  │ (Bloom,    │   │ (producer)  │   │ (fallback)   │       │
│  │  Rate,     │   │             │   │  + WAL       │       │
│  │  Quota)    │   │             │   │              │       │
│  └────────────┘   └─────────────┘   └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Downstream Consumers                            │
│   analytics-consumer │ enrichment-session │ decision-engine  │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Module | File | Responsibility |
|--------|------|----------------|
| **main** | `src/main.rs` | Bootstrap, config init, router setup, graceful shutdown |
| **handler** | `src/handler.rs` | HTTP layer: auth header extraction, rate-limit checks, body read, decompress, dispatch to pipeline |
| **pipeline** | `src/pipeline.rs` | Event validation, Bloom dedup, quota/restriction checks, clock-skew correction, topic routing, enrichment, serialization |
| **config** | `src/config.rs` | Environment configuration via `envconfig` |
| **sinks/** | `src/sinks/*.rs` | Abstraction layer for Kafka and S3 output |
| **rate_limiter** | `src/rate_limiter.rs` | In-process and distributed rate limiters |
| **quota_limiter** | `src/quota_limiter.rs` | Per-store quota exceeded checks |
| **restrictions** | `src/restrictions.rs` | Per-store event restriction filtering |
| **decompression** | `src/decompression.rs` | gzip/deflate/br/zstd body decompression |
| **health** | `src/health.rs` | Liveness/readiness probes, Kafka health tracking |
| **metrics** | `src/metrics.rs` | Prometheus metrics recorder setup |
| **errors** | `src/errors.rs` | Application error types |

## Data Flow

### Request Lifecycle

1. **Ingress** — Client sends `POST /v1/track` with optional `Content-Encoding` compression and `X-Store-ID` header (injected by Kong).
2. **Decompression** — Body is decompressed if `Content-Encoding` is set (`gzip`, `deflate`, `br`, `zstd`).
3. **Rate Limiting (HTTP layer)** — In-process `StoreLimiter` gate, then optional distributed `DistributedStoreLimiter` (Redis sliding window). 429 returned immediately if limited.
4. **Pipeline Processing** — For each event in the envelope:
   - **Validation** — Required fields, UUID v7 `eid`, length limits, timestamp sanity.
   - **Deduplication** — Batch Bloom filter check via Redis (`BF.EXISTS` pipelined across today/yesterday windows).
   - **Illegal ID check** — Placeholder distinct IDs disable person processing.
   - **Quota check** — If store exceeded quota, event dropped.
   - **Restriction check** — If event type is restricted for store, event dropped.
   - **Clock-skew correction** — Adjusts `ts` by `(server_received_at - sent_at)` clamped to ±30 min unless SDK requests `disable_skew_correction`.
   - **Enrichment** — Adds `store_id`, `source`, `server_received_at`, `ip`, `cookieless_mode`, `process_person_profile`.
   - **Size check** — If serialized payload exceeds `MAX_EVENT_BYTES`, sent to DLQ.
   - **Historical rerouting** — Events older than `HISTORICAL_THRESHOLD_DAYS` reroute to `historical.events` topic.
   - **Overflow routing** — Hot `(store_id, anon)` pairs rerouted to `overflow.events` with empty partition key.
   - **Topic classification** — `$exception` → `error.events`, `$identify`/`$alias`/`$create_alias` → `identify.events`, `$checkout_*`/`order_*`/`purchase`/`checkout_started` → `checkout.events`, all else → `raw.events`.
   - **Produce** — Sent to Kafka with typed `SinkHeaders`. On `KafkaError`, transparently retried via S3 fallback.
5. **Response** — Returns `BatchResult` with per-event outcomes (`ok`, `drop`, `warning`, `retry`).
6. **Graceful Shutdown** — Drains Kafka producer for `KAFKA_DRAIN_TIMEOUT_SECS`, then exits.

## API Contract

### POST /v1/track

Accepts a batch of tracking events.

**Headers:**
- `X-Store-ID: <u32>` — Required. Injected by Kong from validated API key.
- `X-Source: browser|backend` — Optional. Defaults to `browser`.
- `X-Real-IP` or `X-Forwarded-For` — Client IP (set by Kong).
- `Content-Encoding: gzip|deflate|br|zstd` — Optional body compression.

**Body:**
```json
{
  "sent_at": 1700000000000,
  "events": [
    {
      "eid": "01906b67-0000-7000-8000-000000000001",
      "seq": 1,
      "t": "$page_view",
      "ts": 1700000000000,
      "sid": "session-abc",
      "anon": "anon-123",
      "uid": "user-456",
      "props": { "page": "/home" },
      "$set": { "name": "John" },
      "$set_once": { "first_seen": 1700000000000 },
      "url": "https://example.com/home",
      "ref": "https://example.com",
      "window_id": "win-1",
      "pageview_id": "pv-1",
      "offset": 0,
      "schema_v": 1,
      "options": {
        "disable_skew_correction": false,
        "cookieless_mode": false,
        "process_person_profile": false
      }
    }
  ]
}
```

**Response 202 Accepted:**
```json
{
  "results": {
    "01906b67-0000-7000-8000-000000000001": {
      "result": "ok",
      "reason": null
    }
  }
}
```

**Outcome values:**
- `ok` — Event accepted.
- `drop` — Event rejected (validation failure, duplicate, quota exceeded, restricted, oversized).
- `warning` — Event accepted but with a flag (e.g., illegal distinct ID disables person processing).
- `retry` — Kafka produce failed; event not persisted.

### GET /metrics

Prometheus metrics endpoint. Returns text/format metrics for scraping.

### GET /live

Liveness probe. Returns 200 if the service is running.

### GET /ready

Readiness probe. Returns 200 only if Kafka producer is healthy and background caches are warmed.

## Configuration

Configuration is loaded exclusively from environment variables via `envconfig`.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP listen port |
| `KAFKA_HOSTS` | `localhost:9092` | Comma-separated Kafka bootstrap brokers |
| `KAFKA_TOPIC_RAW` | `raw.events` | Default analytics topic |
| `KAFKA_TOPIC_ERROR` | `error.events` | Exception events topic |
| `KAFKA_TOPIC_IDENTIFY` | `identify.events` | Identify/alias events topic |
| `KAFKA_TOPIC_CHECKOUT` | `checkout.events` | Checkout/order events topic |
| `KAFKA_TOPIC_DLQ` | `dlq.events` | Dead-letter queue for invalid/oversized events |
| `KAFKA_TOPIC_OVERFLOW` | `overflow.events` | Hot-partition overflow rerouting topic |
| `KAFKA_TOPIC_HISTORICAL` | `historical.events` | Historical event rerouting topic |
| `KAFKA_PRODUCER_LINGER_MS` | `20` | Producer batch linger time |
| `KAFKA_PRODUCER_QUEUE_MIB` | `400` | Producer queue memory limit |
| `KAFKA_MESSAGE_TIMEOUT_MS` | `20000` | Per-message produce timeout |
| `KAFKA_COMPRESSION_CODEC` | `snappy` | Producer compression codec |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `REDIS_BLOOM_KEY` | `idem:bloom` | Bloom filter key prefix |
| `LOG_LEVEL` | `info` | Tracing filter string |
| `HTTP_REQUEST_TIMEOUT_MS` | `30000` | Total request timeout (slow-loris protection) |
| `MAX_EVENT_BYTES` | `1048576` | Max serialized event payload size (1 MiB) |
| `MAX_REQUEST_BODY_BYTES` | `10485760` | Max raw (compressed) request body size (10 MiB) |
| `BODY_CHUNK_TIMEOUT_MS` | — | Per-chunk body read timeout (disabled by default) |
| `RATE_LIMIT_ENABLED` | `true` | Enable per-store in-process rate limiter |
| `RATE_LIMIT_PER_SECOND` | `1000` | Rate limit steady-state |
| `RATE_LIMIT_BURST` | `5000` | Rate limit burst size |
| `RATE_LIMIT_DRY_RUN` | `false` | Shadow-mode rate limiting (no rejections) |
| `OVERFLOW_ENABLED` | `false` | Enable hot-partition overflow limiter |
| `OVERFLOW_PER_SECOND` | `100` | Overflow limiter steady-state |
| `OVERFLOW_BURST` | `1000` | Overflow limiter burst size |
| `OVERFLOW_DRY_RUN` | `false` | Shadow-mode overflow limiting |
| `DISTRIBUTED_RATE_LIMIT_ENABLED` | `false` | Enable cross-replica Redis rate limiter |
| `DISTRIBUTED_RATE_LIMIT_PER_SECOND` | `1000` | Distributed rate limit |
| `DISTRIBUTED_RATE_LIMIT_DRY_RUN` | `false` | Shadow-mode distributed rate limiting |
| `QUOTA_LIMITER_ENABLED` | `false` | Enable per-store quota exceeded checks |
| `QUOTA_REFRESH_INTERVAL_S` | `60` | Quota cache refresh interval |
| `RESTRICTIONS_ENABLED` | `false` | Enable per-store event restriction filtering |
| `RESTRICTIONS_REFRESH_INTERVAL_S` | `60` | Restriction cache refresh interval |
| `S3_FALLBACK_ENABLED` | `false` | Enable S3 fallback sink for Kafka errors |
| `S3_FALLBACK_BUCKET` | — | S3 bucket name (required when fallback enabled) |
| `S3_ENDPOINT_URL` | — | S3-compatible endpoint override (e.g., MinIO) |
| `S3_REGION` | `us-east-1` | S3 region |
| `WAL_ENABLED` | `true` | Enable SQLite write-ahead log for S3 durability |
| `WAL_DB_PATH` | `/tmp/ingestion-s3-wal.db` | SQLite WAL file path |
| `ADVISORY_FALLBACK_ENABLED` | `true` | Proactive S3 routing when Kafka stats stale |
| `KAFKA_HEALTH_THRESHOLD_MS` | `15000` | Kafka stats staleness threshold |
| `HISTORICAL_REROUTING_ENABLED` | `false` | Enable historical event rerouting |
| `HISTORICAL_THRESHOLD_DAYS` | `1` | Events older than this are rerouted |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP gRPC endpoint (e.g., `http://tempo:4317`) |
| `OTEL_SERVICE_NAME` | `ingestion` | Service name for OTel resource |
| `OTEL_SAMPLE_RATIO` | `1.0` | Trace sampling ratio 0.0–1.0 |
| `KAFKA_DRAIN_TIMEOUT_SECS` | `30` | Graceful shutdown drain timeout |
| `BLOOM_CAPACITY` | `1000000` | Bloom filter expected daily distinct count |
| `BLOOM_FPP` | `0.001` | Bloom filter false-positive probability |
| `BATCH_BLOOM_ENABLED` | `true` | Enable pipelined batch Bloom checks (1 RTT) |

## Dependencies

### Core Runtime

| Crate | Version | Purpose |
|-------|---------|---------|
| `axum` | 0.7 | HTTP server and routing |
| `tokio` | 1 | Async runtime |
| `rdkafka` | 0.36 | Kafka producer |

### Observability

| Crate | Version | Purpose |
|-------|---------|---------|
| `tracing` / `tracing-subscriber` | 0.1 / 0.3 | Structured logging with JSON formatter |
| `metrics` / `metrics-exporter-prometheus` | 0.23 / 0.15 | Prometheus metrics |
| `opentelemetry` / `opentelemetry-sdk` / `opentelemetry-otlp` / `tracing-opentelemetry` | 0.22 / 0.22 / 0.15 / 0.23 | OTLP distributed tracing |

### Resilience

| Crate | Version | Purpose |
|-------|---------|---------|
| `governor` | 0.6 | Token-bucket rate limiting (in-process) |
| `redis` | 0.25 | Redis client (distributed rate limit, Bloom, quota, restrictions) |

### S3 & Durability

| Crate | Version | Purpose |
|-------|---------|---------|
| `aws-sdk-s3` / `aws-config` | 1 | S3 fallback sink |
| `rusqlite` | 0.31 | SQLite WAL for S3 crash recovery |

### Body Handling

| Crate | Version | Purpose |
|-------|---------|---------|
| `bytes` | 1 | Body buffer |
| `flate2` | 1 | gzip/deflate decompression |
| `brotli` | 7 | Brotli decompression |
| `zstd` | 0.13 | Zstandard decompression |
| `http-body-util` | 0.1 | Body combinators |

### Serialization & Config

| Crate | Version | Purpose |
|-------|---------|---------|
| `serde` / `serde_json` | 1 | Serialization |
| `envconfig` | 0.10 | Env-based configuration |
| `uuid` | 1 | UUID parsing for `eid` |
| `chrono` | 0.4 | Timestamp handling |
| `thiserror` | 1 | Error definitions |
| `anyhow` | 1 | Error construction |
| `async-trait` | 0.1 | Async trait for `Sink` |
| `futures` | 0.3 | Stream utilities |

## Sink Architecture

### Sink Trait (`src/sinks/mod.rs`)

```rust
#[async_trait]
pub trait Sink: Send + Sync {
    async fn send(
        &self,
        topic: &str,
        key: &str,
        payload: &str,
        headers: &SinkHeaders,
    ) -> Result<(), AppError>;
}
```

`SinkHeaders` carry typed metadata (store ID, source, anon ID, session ID, event type, timestamps, processing flags) that downstream consumers can read from Kafka message headers without full JSON deserialization.

### KafkaSink (`src/sinks/kafka.rs`)

Wraps `rdkafka::FutureProducer` and delegates to `kafka::produce`. Produces JSON payloads with typed headers to the specified topic.

### FallbackSink (`src/sinks/fallback.rs`)

Composes a primary (`KafkaSink`) and fallback (`S3Sink`):

- **Reactive fallback:** When `KafkaSink` returns `KafkaError`, the event is forwarded to S3.
- **Advisory proactive fallback:** When `advisory_fallback_enabled=true` and Kafka has not reported healthy within `threshold_ms`, events bypass Kafka entirely and go straight to S3, avoiding producer timeout latency.

If the fallback sink also fails, the event is lost (logged and metric `ingestion_fallback_double_fault_total` incremented).

### S3Sink (`src/sinks/s3.rs`)

Writes events to S3 as JSON lines (one JSON object per line) in a configurable bucket/prefix. Uses buffered in-memory writes flushed on buffer size or interval.

### WALSink (`src/sinks/wal.rs`)

A durable SQLite write-ahead log wrapping the S3 sink. Events are written to a local SQLite database first; on restart, unflushed entries are replayed to S3, ensuring crash safety.

## Rate Limiting & Safety

### Per-Store In-Process Rate Limiter (`StoreLimiter`)

Token-bucket algorithm via `governor` with `DashMap` state store. Keyed on `store_id`. Checked at HTTP handler layer before the event enters the pipeline. Returns 429 when limited.

- Dry-run mode tracks metrics but never rejects.
- Independent steady-state (`RATE_LIMIT_PER_SECOND`) and burst (`RATE_LIMIT_BURST`) settings.

### Hot-Partition Overflow Limiter (`OverflowLimiter`)

Token-bucket keyed on `"{store_id}:{anon_id}"`. Checked inside the pipeline. When a `(store_id, anon)` pair exceeds the threshold, the event is rerouted to `overflow.events` topic with an empty partition key, allowing Kafka to round-robin across all partitions and prevent hot-partition lag.

### Distributed Rate Limiter (`DistributedStoreLimiter`)

Redis-backed sliding window using an atomic Lua script (`ZREMRANGEBYSCORE` + `ZCARD` + `ZADD`). Fails open when Redis is unavailable. Runs after the in-process gate.

### Quota Limiter (`QuotaLimiter`)

In-memory cache of store quota states refreshed from Redis. When a store's quota is exceeded, all events for that store are dropped.

### Event Restrictions (`RestrictionStore`)

Similar to quota limiter: drops events for `(store_id, event_type)` pairs that are restricted per organization policy.

## Deduplication

Uses Redis Bloom filter (`BF.EXISTS`, `BF.INSERT`). Keys are bucketed by calendar day (`{prefix}:{YYYYMMDD}`) with a 48-hour TTL for cross-midnight deduplication. Batch mode (`BATCH_BLOOM_ENABLED=true`) pipelines all Bloom checks into a single Redis round-trip per request.

## Observability

### Metrics (Prometheus)

Key metrics emitted:
- `ingestion_events_accepted_total` — Accepted events
- `ingestion_rate_limited_total` — Rate-limited requests
- `ingestion_bloom_dedup_batch_size` — Batch sizes for Bloom checks
- `ingestion_produce_duration_seconds` — Kafka produce latency
- `ingestion_event_payload_bytes` — Payload size distribution
- `ingestion_clock_skew_seconds` — Clock skew distribution
- `ingestion_overflow_rerouted_total` — Overflow reroutes
- `ingestion_fallback_activations_total` — Reactive S3 fallbacks
- `ingestion_fallback_proactive_total` — Proactive S3 fallbacks
- `ingestion_fallback_double_fault_total` — Both Kafka and S3 failed
- `ingestion_auth_failures_total` — Missing/malformed `X-Store-ID`
- `ingestion_illegal_id_total` — Placeholder distinct IDs detected
- `ingestion_quota_exceeded_total` — Quota drops
- `ingestion_restricted_event_total` — Restricted event drops

### Logging

JSON-formatted structured logs via `tracing-subscriber` with `env-filter`. All request spans include `store_id`.

### Distributed Tracing

Optional OTLP export via `opentelemetry-otlp` (tonic gRPC). Configurable `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, and `OTEL_SAMPLE_RATIO`.

## Health Checks

- **GET /live** — Always returns 200 if the process is running.
- **GET /ready** — Returns 200 only when the Kafka producer has reported healthy within the configured threshold and background caches are initialized.

## Deployment

### Docker Build

Two-stage Dockerfile:
1. **Builder:** `rust:1-bookworm` installs build dependencies and compiles the release binary.
2. **Runtime:** `debian:bookworm-slim` copies the binary and runtime libraries (`libssl3`, `zlib1g`, `ca-certificates`).

### Nx Integration

`project.json` defines targets using `@monodon/rust:build`, `@monodon/rust:test`, `@monodon/rust:lint`, and `@monodon/rust:run`. Build artifacts go to `dist/target/ingestion`.

### Local Development

`Dockerfile.dev` installs `cargo-watch` for live reloading during development.

## Graceful Shutdown

On SIGINT (Ctrl+C):
1. Listening socket stops accepting new connections.
2. In-flight requests are allowed to complete (up to `HTTP_REQUEST_TIMEOUT_MS`).
3. Kafka producer is drained for up to `KAFKA_DRAIN_TIMEOUT_SECS` seconds.
4. OTLP tracer provider is shut down.
5. Health status is set to `Completed`.

## Error Handling

- **4xx/5xx** — Client errors return appropriate HTTP status codes (400, 401, 429, 500).
- **KafkaError** — Trigger S3 fallback or mark event as `retry`.
- **Redis errors** — Fail open for rate limiting; Bloom dedup proceeds without deduplication.
- **Invalid events** — Sent to DLQ; batch continues processing.

## Testing

- Inline unit tests in `pipeline.rs` cover validation, classification, and event option parsing.
- Rate limiter unit tests in `rate_limiter.rs` cover disabled/dry-run behavior.

Run tests via:
```bash
nx test ingestion