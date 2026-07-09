-- ClickHouse materialized view for pre-aggregated customer features
-- Used by FeatureService (decision-engine) to avoid inline aggregation on every decision.
-- Run once to create; ClickHouse populates it incrementally as new events arrive.
--
-- Usage:
--   SELECT abandonment_rate_7d, avg_cart_value_30d
--   FROM mv_customer_features
--   WHERE store_id = ? AND distinct_id = ?

-- Base aggregate table (populated by the materialized view trigger)
CREATE TABLE IF NOT EXISTS customer_features_agg
(
    store_id          UInt32,
    distinct_id       String,
    window_date       Date,
    sessions_total    UInt32,
    sessions_abandoned UInt32,
    cart_value_sum    Float64,
    cart_value_count  UInt32
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(window_date)
ORDER BY (store_id, distinct_id, window_date);

-- Materialized view: triggers on inserts into the `events` table
-- Adjust source table name to match your ClickHouse events table.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_customer_features_trigger
TO customer_features_agg
AS
SELECT
    store_id,
    anon                                                            AS distinct_id,
    toDate(timestamp)                                               AS window_date,
    1                                                               AS sessions_total,
    if(t = 'checkout_abandon', 1, 0)                               AS sessions_abandoned,
    toFloat64(JSONExtractFloat(properties, 'cart_value'))           AS cart_value_sum,
    if(JSONHas(properties, 'cart_value'), 1, 0)                    AS cart_value_count
FROM events
WHERE t IN ('session_start', 'checkout_abandon');

-- Final view: aggregates the rolling 7-day and 30-day windows
-- Query this view from FeatureService (one row per store+distinct_id).
CREATE VIEW IF NOT EXISTS mv_customer_features AS
SELECT
    store_id,
    distinct_id,
    -- 7-day abandonment rate
    sumIf(sessions_abandoned, window_date >= today() - 7)
        / greatest(sumIf(sessions_total, window_date >= today() - 7), 1)  AS abandonment_rate_7d,
    -- 30-day average cart value
    sumIf(cart_value_sum, window_date >= today() - 30)
        / greatest(sumIf(cart_value_count, window_date >= today() - 30), 1) AS avg_cart_value_30d
FROM customer_features_agg
WHERE window_date >= today() - 30
GROUP BY store_id, distinct_id;
