-- MRT Time · BigQuery starter 3/4 · Weekly retention cohorts
--
-- Cohort = the Monday-starting SGT week of a user's first visit
-- (user_first_touch_timestamp; the first week seen in the window when that
-- is missing). week_n = weeks since the cohort week; retention = active
-- users that week / cohort size. "Active" = opened a page or used a
-- feature. Pivot week_n into columns in Looker Studio or a spreadsheet for
-- the usual triangle.
-- Replace PROJECT and PROPERTY_ID. Users with any internal event are left out.

DECLARE weeks INT64 DEFAULT 8;
DECLARE window_start DATE DEFAULT DATE_TRUNC(DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL weeks WEEK), WEEK(MONDAY));

WITH ev AS (
  SELECT
    user_pseudo_id,
    user_first_touch_timestamp,
    DATE_TRUNC(DATE(TIMESTAMP_MICROS(event_timestamp), 'Asia/Singapore'), WEEK(MONDAY)) AS week,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', window_start)
    AND event_name IN ('session_start', 'page_view', 'prediction_view', 'planner_query')
),
internal AS (
  SELECT DISTINCT user_pseudo_id FROM ev WHERE traffic_type = 'internal'
),
user_weeks AS (
  SELECT ev.user_pseudo_id, ev.week, MIN(ev.user_first_touch_timestamp) AS first_touch
  FROM ev
  LEFT JOIN internal i ON i.user_pseudo_id = ev.user_pseudo_id
  WHERE i.user_pseudo_id IS NULL
  GROUP BY ev.user_pseudo_id, ev.week
),
cohorts AS (
  SELECT
    user_pseudo_id,
    COALESCE(
      DATE_TRUNC(DATE(TIMESTAMP_MICROS(MIN(first_touch)), 'Asia/Singapore'), WEEK(MONDAY)),
      MIN(week)
    ) AS cohort
  FROM user_weeks
  GROUP BY user_pseudo_id
),
sizes AS (
  SELECT cohort, COUNT(*) AS cohort_users FROM cohorts WHERE cohort >= window_start GROUP BY cohort
)
SELECT
  c.cohort,
  s.cohort_users,
  DATE_DIFF(w.week, c.cohort, WEEK(MONDAY)) AS week_n,
  COUNT(*) AS active_users,
  ROUND(COUNT(*) / s.cohort_users, 3) AS retention
FROM user_weeks w
JOIN cohorts c ON c.user_pseudo_id = w.user_pseudo_id
JOIN sizes s ON s.cohort = c.cohort
WHERE w.week >= c.cohort
GROUP BY c.cohort, s.cohort_users, week_n
ORDER BY c.cohort, week_n;
