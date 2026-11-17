-- MRT Time · BigQuery starter 4/4 · Attribution: first touch vs last touch
--
-- Credits every planner_query (the primary key event) to a source / medium
-- under two models, so you can compare them side by side:
--   first touch (user)    traffic_source.source / medium: how the user first
--                         arrived (user-scoped, set once by GA4).
--   last touch (session)  the session the planner_query happened in: its
--                         first UTM (collected_traffic_source.manual_*), else
--                         the referrer host of its first page with an outside
--                         referrer, else (direct).
-- Newer exports also carry GA4's own session attribution in
-- session_traffic_source_last_click (verify it is in your schema); this
-- query builds it from raw fields so the logic is visible.
-- KOL links (/k/<handle>) arrive as utm_source=<handle>, utm_medium=kol.
-- Replace PROJECT and PROPERTY_ID. Users with any internal event are left out.

DECLARE days INT64 DEFAULT 28;
DECLARE own_domain STRING DEFAULT '91208274.xyz';

WITH ev AS (
  SELECT
    user_pseudo_id,
    event_name,
    event_timestamp,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'page_referrer') AS page_referrer,
    collected_traffic_source.manual_source AS utm_source,
    collected_traffic_source.manual_medium AS utm_medium,
    traffic_source.source AS first_source,
    traffic_source.medium AS first_medium
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL days DAY))
                          AND FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Singapore'))
),
internal AS (
  SELECT DISTINCT user_pseudo_id FROM ev WHERE traffic_type = 'internal'
),
clean AS (
  SELECT ev.*
  FROM ev
  LEFT JOIN internal i ON i.user_pseudo_id = ev.user_pseudo_id
  WHERE i.user_pseudo_id IS NULL AND ev.session_id IS NOT NULL
),
session_source AS (
  SELECT
    user_pseudo_id,
    session_id,
    COALESCE(
      ARRAY_AGG(
        IF(utm_source IS NULL, NULL, CONCAT(utm_source, ' / ', IFNULL(utm_medium, '(not set)')))
        IGNORE NULLS ORDER BY event_timestamp LIMIT 1
      )[SAFE_OFFSET(0)],
      ARRAY_AGG(
        IF(NET.HOST(page_referrer) IS NULL OR NET.REG_DOMAIN(page_referrer) = own_domain, NULL,
           CONCAT(NET.HOST(page_referrer), ' / referral'))
        IGNORE NULLS ORDER BY event_timestamp LIMIT 1
      )[SAFE_OFFSET(0)],
      '(direct) / (none)'
    ) AS source_medium
  FROM clean
  GROUP BY user_pseudo_id, session_id
),
conversions AS (
  SELECT
    c.user_pseudo_id,
    CONCAT(IFNULL(c.first_source, '(direct)'), ' / ', IFNULL(c.first_medium, '(none)')) AS first_touch,
    s.source_medium AS last_touch
  FROM clean c
  JOIN session_source s ON s.user_pseudo_id = c.user_pseudo_id AND s.session_id = c.session_id
  WHERE c.event_name = 'planner_query'
)
SELECT 'first touch (user)' AS model, first_touch AS source_medium,
       COUNT(*) AS planner_queries, COUNT(DISTINCT user_pseudo_id) AS users
FROM conversions
GROUP BY first_touch
UNION ALL
SELECT 'last touch (session)', last_touch, COUNT(*), COUNT(DISTINCT user_pseudo_id)
FROM conversions
GROUP BY last_touch
ORDER BY model, planner_queries DESC;
