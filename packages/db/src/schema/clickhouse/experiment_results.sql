-- ClickHouse experiment_results materialized view
-- Pre-aggregates exposure and conversion counts per experiment variant.
-- Powers admin API GET /admin/experiments/{id}/results
-- Depends on: intervention_events_local (create intervention_events.sql first)

CREATE MATERIALIZED VIEW experiment_results_local ON CLUSTER default_cluster
ENGINE = AggregatingMergeTree()
ORDER BY (experiment_id, variant, date)
AS SELECT
    experiment_id,
    variant,
    toDate(timestamp)                          AS date,
    countState()                               AS exposures,
    countIfState(event_type = 'accepted')      AS conversions
FROM intervention_events_local
WHERE experiment_id != ''
GROUP BY experiment_id, variant, date;

CREATE TABLE experiment_results ON CLUSTER default_cluster
AS experiment_results_local
ENGINE = Distributed(default_cluster, default, experiment_results_local, rand());

-- ============================================================
-- Query pattern for admin API results endpoint:
--
-- SELECT
--     experiment_id,
--     variant,
--     sum(countMerge(exposures))    AS total_exposures,
--     sum(countMerge(conversions))  AS total_conversions,
--     sum(countMerge(conversions)) / greatest(sum(countMerge(exposures)), 1) AS conversion_rate
-- FROM experiment_results_local
-- WHERE experiment_id = '{id}'
-- GROUP BY experiment_id, variant
-- ORDER BY variant;
-- ============================================================
