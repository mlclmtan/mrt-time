-- MRT Time · BigQuery starter 1/4 · Sessions and engagement
--
-- Sessions per SGT day by device category and installed-app use
-- (`standalone` = yes/no, an app event param): sessions, engaged sessions,
-- engagement rate, average engaged seconds, users.
-- Replace PROJECT and PROPERTY_ID. A session with any internal event
-- (owner/analyst, traffic_type = internal) is left out.
-- Works on the practice property too (its dataset has its own PROPERTY_ID).

DECLARE days INT64 DEFAULT 28;

WITH ev AS (
  SELECT
    user_pseudo_id,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS session_id,
    DATE(TIMESTAMP_MICROS(event_timestamp), 'Asia/Singapore') AS day,
    device.category AS device_category,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'standalone') AS standalone,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'session_engaged') AS session_engaged,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'engagement_time_msec') AS engagement_time_msec,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type') AS traffic_type
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL days DAY))
                          AND FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Singapore'))
),
sessions AS (
  SELECT
    user_pseudo_id,
    session_id,
    MIN(day) AS day,
    ANY_VALUE(device_category) AS device_category,
    LOGICAL_OR(standalone = 'yes') AS standalone,
    LOGICAL_OR(session_engaged = '1') AS engaged,
    SUM(IFNULL(engagement_time_msec, 0)) / 1000 AS engaged_seconds
  FROM ev
  WHERE session_id IS NOT NULL
  GROUP BY user_pseudo_id, session_id
  HAVING LOGICAL_AND(IFNULL(traffic_type, '') != 'internal')
)
SELECT
  day,
  device_category,
  standalone,
  COUNT(*) AS sessions,
  COUNTIF(engaged) AS engaged_sessions,
  ROUND(SAFE_DIVIDE(COUNTIF(engaged), COUNT(*)), 3) AS engagement_rate,
  ROUND(AVG(engaged_seconds), 1) AS avg_engaged_seconds,
  COUNT(DISTINCT user_pseudo_id) AS users
FROM sessions
GROUP BY day, device_category, standalone
ORDER BY day DESC, sessions DESC;
