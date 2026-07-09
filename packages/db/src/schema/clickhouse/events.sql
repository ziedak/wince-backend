-- ClickHouse events table — canonical DDL
-- Source of truth for the analytics-consumer batch insert schema.
-- Run once against each ClickHouse cluster node; use ON CLUSTER for replicated setups.
--
-- Schema mirrors apps/analytics-consumer/src/types.ts::ClickHouseRow exactly.
-- customer_email is intentionally absent (PII policy: docs/domains/security.md:81).

CREATE TABLE events_local ON CLUSTER default_cluster
(
    timestamp          DateTime64(3) CODEC(Delta, ZSTD),
    eid                String        CODEC(ZSTD),
    t                  LowCardinality(String),
    sid                String,
    anon               String,
    store_id           UInt32,
    customer_id        Nullable(UInt32),
    cart_value         Float64,
    lifetime_value     Float64,
    email_consent      UInt8,
    sms_consent        UInt8,
    rage_click_count   UInt8,
    is_frustrated      UInt8,
    session_available  UInt8,
    properties         JSON,
    server_timestamp   DateTime64(3) DEFAULT now64()
) ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/events_local', '{replica}')
PARTITION BY toYYYYMM(timestamp)
ORDER BY (store_id, t, timestamp)
TTL timestamp + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

-- Distributed table (query across shards)
CREATE TABLE events ON CLUSTER default_cluster
AS events_local
ENGINE = Distributed(default_cluster, default, events_local, rand());

-- ============================================================
-- Materialized view: daily abandonment + revenue aggregates
-- ============================================================
CREATE MATERIALIZED VIEW daily_abandonment_stats_local ON CLUSTER default_cluster
ENGINE = SummingMergeTree()
ORDER BY (store_id, date)
AS SELECT
    toDate(timestamp)                                              AS date,
    store_id,
    countIf(t = 'checkout_abandon')                                AS abandonments,
    countIf(t = 'purchase')                                        AS purchases,
    sumIf(cart_value, t = 'purchase')                              AS recovered_revenue
FROM events_local
GROUP BY date, store_id;

CREATE TABLE daily_abandonment_stats ON CLUSTER default_cluster
AS daily_abandonment_stats_local
ENGINE = Distributed(default_cluster, default, daily_abandonment_stats_local, rand());
