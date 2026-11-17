-- MRT Time · BigQuery starter 2/4 · Funnel
--
-- The admin funnel (open → see a prediction → plan a journey → install)
-- as a closed funnel per user over the last N days: each step counts only
-- when it happened at or after the user's previous step.
-- "Installed" = app_installed OR standalone_open: iOS Safari never fires
-- app_installed, but an iPhone home-screen open shows up as standalone_open.
-- Replace PROJECT and PROPERTY_ID. Users with any internal event are left out.

DECLARE days INT64 DEFAULT 28;

WITH ev AS (
  SELECT
    user_pseudo_id,
    event_name,
    event_timestamp,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL days DAY))
                          AND FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Singapore'))
    AND event_name IN ('session_start', 'page_view', 'prediction_view', 'planner_query', 'app_installed', 'standalone_open')
),
internal AS (
  SELECT DISTINCT user_pseudo_id FROM ev WHERE traffic_type = 'internal'
),
clean AS (
  SELECT ev.*
  FROM ev
  LEFT JOIN internal i ON i.user_pseudo_id = ev.user_pseudo_id
  WHERE i.user_pseudo_id IS NULL
),
s1 AS (
  SELECT user_pseudo_id, MIN(event_timestamp) AS t
  FROM clean WHERE event_name IN ('session_start', 'page_view')
  GROUP BY user_pseudo_id
),
s2 AS (
  SELECT c.user_pseudo_id, MIN(c.event_timestamp) AS t
  FROM clean c JOIN s1 ON s1.user_pseudo_id = c.user_pseudo_id
  WHERE c.event_name = 'prediction_view' AND c.event_timestamp >= s1.t
  GROUP BY c.user_pseudo_id
),
s3 AS (
  SELECT c.user_pseudo_id, MIN(c.event_timestamp) AS t
  FROM clean c JOIN s2 ON s2.user_pseudo_id = c.user_pseudo_id
  WHERE c.event_name = 'planner_query' AND c.event_timestamp >= s2.t
  GROUP BY c.user_pseudo_id
),
s4 AS (
  SELECT c.user_pseudo_id, MIN(c.event_timestamp) AS t
  FROM clean c JOIN s3 ON s3.user_pseudo_id = c.user_pseudo_id
  WHERE c.event_name IN ('app_installed', 'standalone_open') AND c.event_timestamp >= s3.t
  GROUP BY c.user_pseudo_id
),
counts AS (
  SELECT 1 AS step, 'Opened MRT Time' AS step_name, COUNT(*) AS users FROM s1
  UNION ALL SELECT 2, 'Saw a prediction', COUNT(*) FROM s2
  UNION ALL SELECT 3, 'Planned a journey', COUNT(*) FROM s3
  UNION ALL SELECT 4, 'Installed / opened the app', COUNT(*) FROM s4
)
SELECT
  step,
  step_name,
  users,
  ROUND(SAFE_DIVIDE(users, FIRST_VALUE(users) OVER (ORDER BY step)), 3) AS share_of_opened,
  ROUND(SAFE_DIVIDE(users, LAG(users) OVER (ORDER BY step)), 3) AS share_of_previous_step
FROM counts
ORDER BY step;
