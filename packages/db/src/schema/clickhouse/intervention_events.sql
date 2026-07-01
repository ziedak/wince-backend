-- ClickHouse intervention_events table + daily_intervention_stats MV
-- Written by the analytics-consumer when it processes $intervention_* tracker events.
-- Mirrors the PostgreSQL intervention_events table with a 90-day TTL.

CREATE TABLE intervention_events_local ON CLUSTER default_cluster
(
    event_id         String,
    intervention_id  String,
    store_id         UInt32,
    distinct_id      String,
    event_type       LowCardinality(String),  -- 'shown'|'dismissed'|'clicked'|'accepted'|'ignored'|'suppressed'
    reason           String,
    variant          String,
    experiment_id    String,
    timestamp        DateTime64(3, 'UTC'),
    properties       String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (store_id, intervention_id, timestamp)
TTL timestamp + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

CREATE TABLE intervention_events ON CLUSTER default_cluster
AS intervention_events_local
ENGINE = Distributed(default_cluster, default, intervention_events_local, rand());

-- ============================================================
-- Materialized view: daily intervention funnel stats
-- Powers admin API GET /admin/analytics/recovery
-- ============================================================
CREATE MATERIALIZED VIEW daily_intervention_stats_local ON CLUSTER default_cluster
ENGINE = SummingMergeTree()
ORDER BY (store_id, date)
AS SELECT
    toDate(timestamp)                          AS date,
    store_id,
    countIf(event_type = 'shown')              AS interventions_shown,
    countIf(event_type = 'clicked')            AS interventions_clicked,
    countIf(event_type = 'accepted')           AS interventions_accepted,
    countIf(event_type = 'dismissed')          AS interventions_dismissed
FROM intervention_events_local
GROUP BY date, store_id;

CREATE TABLE daily_intervention_stats ON CLUSTER default_cluster
AS daily_intervention_stats_local
ENGINE = Distributed(default_cluster, default, daily_intervention_stats_local, rand());
