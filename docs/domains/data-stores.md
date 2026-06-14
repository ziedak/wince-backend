# Data Stores

Central reference for persistent storage and cache layers.

## PostgreSQL

- Stores business entities such as stores, customers, interventions, discount codes, budgets, policy rules, experiments, users, usage, and processed events.
- Acts as the source of truth for daily budget, compliance state, audit-adjacent business records, and processed-event tracking.
- Should be accessed through PgBouncer to keep connection counts stable under load.
- Core tables include `stores`, `customers`, `interventions`, `discount_codes`, `daily_budget`, `policy_rules`, `experiments`, `admin_users`, `store_usage`, `processed_events`, and `audit_logs`.

## ClickHouse

- Stores analytical event data.
- Used for aggregations, reporting, attribution, and derived metrics.
- Must not be treated as authoritative for operational state.
- Cluster with 2 shards, 2 replicas each. Events partitioned by month, ordered by `(store_id, event_type, timestamp)`, TTL 90 days.
- Core `events` table columns: `timestamp`, `event_type`, `session_id`, `distinct_id`, `store_id`, `customer_email`, `cart_value`, `rage_click_count`, `is_frustrated`, `properties`, `server_timestamp`.
- Materialized view `daily_abandonment_stats` pre-aggregates abandonment count, purchase count, and recovered revenue per store per day.

## Redis

- Stores session state, active WebSocket state, customer cache, API key cache, policy cache, cooldown markers, budget cache, feature cache, and Bloom filters.
- Used as a fast, short-lived coordination layer for ingestion, enrichment, decisioning, and websocket presence.
- Should be treated as volatile; PostgreSQL remains the source of truth for durable state.
- Cluster mode with shards and replicas. Total memory budget ~50 GB including Bloom filter (~8 GB).

| Key pattern | Type | TTL | Description |
| --- | --- | --- | --- |
| `session:{session_id}` | Hash | 30 min | Session state: cart_value, rage_click_count, last_activity |
| `ws:active:{session_id}` | Hash | 60 s | WebSocket mapping: pod_name, pod_ip, last_seen |
| `cache:customer:{store_id}:{distinct_id}` | Hash | 5 min | Customer profile: email, lifetime_value |
| `cache:apikey:{sha256(api_key)}` | String | 5 min | store_id, rate_limit |
| `policy:store:{store_id}` | Hash | 1 h | Policy rules: max_discount, cooldown |
| `cooldown:{store_id}:{distinct_id}` | String | cooldown_minutes × 60 | Presence only |
| `budget:{store_id}:{date}` | String | 24 h | Daily discount total, write-through to PostgreSQL |
| `feature:{distinct_id}` | Hash | 1 h | Batch features from ClickHouse |
| `idem:bloom` | Bloom filter | — | Event deduplication (RedisBloom) |
| `ratelimit:{key}:{window}` | String | 60 s | Rate limiting counter |

- Bloom filter config: `BF.RESERVE idem:bloom 0.001 6000000000` (0.1% false positive rate, 6 B expected items, ~8 GB).

## S3 / MinIO

- Stores DLQ archives, model binaries, backups, and operational exports.

## Notes

- PII should stay in PostgreSQL, not ClickHouse.
- Budget counters should remain authoritative in PostgreSQL even if Redis is used as a write-through cache.
- Bloom filters in Redis are for fast duplicate detection only; false positives must fall back to PostgreSQL checks.
