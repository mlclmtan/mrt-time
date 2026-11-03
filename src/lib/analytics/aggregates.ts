/**
 * Admin aggregates: server-side SQL over indexed columns (ts, name,
 * device_id). Each builder returns a drizzle SQL fragment; `runRows`
 * executes it on any drizzle Postgres driver (Neon in prod, PGlite in tests).
 * Days/weeks are Singapore calendar days.
 */
import { sql, type SQL } from "drizzle-orm";
import { rowsOf } from "../db";

export type Range = { from: Date; to: Date };

type Executor = { execute: (q: SQL) => Promise<unknown> };
export async function runRows<T>(db: Executor, query: SQL): Promise<T[]> {
  return rowsOf<T>(await db.execute(query));
}

/** SGT wall-clock timestamp for a timestamptz column. */
const sgt = (col: SQL) => sql`((${col}) at time zone 'UTC' + interval '8 hours')`;
const inRange = (r: Range) => sql`ts >= ${r.from.toISOString()}::timestamptz and ts < ${r.to.toISOString()}::timestamptz`;

/** Daily active (consenting) devices. */
export function dauQuery(r: Range) {
  return sql`
    select to_char(${sgt(sql`ts`)}::date, 'YYYY-MM-DD') as day, count(distinct device_id)::int as users
    from event_log where ${inRange(r)} and device_id is not null
    group by 1 order by 1`;
}

/** Distinct devices in the 1/7/30 days ending at `to`. */
export function activeUsersQuery(to: Date) {
  const t = to.toISOString();
  return sql`
    select
      count(distinct device_id) filter (where ts >= ${t}::timestamptz - interval '1 day')::int as dau,
      count(distinct device_id) filter (where ts >= ${t}::timestamptz - interval '7 days')::int as wau,
      count(distinct device_id)::int as mau
    from event_log
    where device_id is not null and ts < ${t}::timestamptz and ts >= ${t}::timestamptz - interval '30 days'`;
}

export function newVsReturningQuery(r: Range) {
  return sql`
    with active as (select distinct device_id from event_log where ${inRange(r)} and device_id is not null),
    firsts as (
      select e.device_id, min(e.ts) as first_ts from event_log e
      join active a on a.device_id = e.device_id group by 1)
    select
      count(*) filter (where first_ts >= ${r.from.toISOString()}::timestamptz)::int as new_users,
      count(*) filter (where first_ts < ${r.from.toISOString()}::timestamptz)::int as returning_users
    from firsts`;
}

/** Sessions, average engaged seconds per session, and all page views (incl. aggregate-only). */
export function sessionsQuery(r: Range) {
  return sql`
    with s as (
      select session_id, extract(epoch from max(ts) - min(ts)) as secs
      from event_log where ${inRange(r)} and session_id is not null group by 1)
    select
      (select count(*) from s)::int as sessions,
      coalesce((select round(avg(secs)::numeric, 1) from s), 0)::float as avg_engaged_sec,
      (select count(*) from event_log where ${inRange(r)} and name = 'page_view')::int as page_views,
      (select count(*) from event_log where ${inRange(r)} and name = 'page_view' and aggregate_only)::int as anonymous_page_views`;
}

export function topQuery(r: Range, dimension: "route" | "station" | "journey" | "referrer" | "utm" | "geo" | "device", limit = 10) {
  switch (dimension) {
    case "route":
      return sql`select route as key, count(*)::int as n from event_log where ${inRange(r)} and name = 'page_view' group by 1 order by 2 desc, 1 limit ${limit}`;
    case "station":
      return sql`select props->>'station' as key, count(*)::int as n from event_log where ${inRange(r)} and name = 'station_view' group by 1 order by 2 desc, 1 limit ${limit}`;
    case "journey":
      return sql`select coalesce(props->>'journey_key', props->>'journey_type') as key, count(*)::int as n from event_log where ${inRange(r)} and name = 'journey_view' group by 1 order by 2 desc, 1 limit ${limit}`;
    case "referrer":
      return sql`select coalesce(substring(referrer from '^https?://([^/]+)'), '(direct)') as key, count(*)::int as n from event_log where ${inRange(r)} and name = 'page_view' group by 1 order by 2 desc, 1 limit ${limit}`;
    case "utm":
      return sql`select concat_ws(' / ', utm_source, utm_medium, utm_campaign) as key, count(distinct coalesce(session_id, id::text))::int as n from event_log where ${inRange(r)} and utm_source is not null group by 1 order by 2 desc, 1 limit ${limit}`;
    case "geo":
      return sql`select concat_ws(' · ', coalesce(country, '??'), city) as key, count(*)::int as n from event_log where ${inRange(r)} and name = 'page_view' group by 1 order by 2 desc, 1 limit ${limit}`;
    case "device":
      return sql`select concat_ws(' · ', coalesce(device_type, 'unknown'), case when standalone then 'standalone' else 'browser' end) as key, count(*)::int as n from event_log where ${inRange(r)} and name = 'page_view' group by 1 order by 2 desc, 1 limit ${limit}`;
  }
}

/** Events by ISO weekday (1=Mon) × hour, Singapore time. */
export function heatmapQuery(r: Range) {
  return sql`
    select extract(isodow from ${sgt(sql`ts`)})::int as dow, extract(hour from ${sgt(sql`ts`)})::int as hour, count(*)::int as n
    from event_log where ${inRange(r)} and name = 'page_view' group by 1, 2 order by 1, 2`;
}

/**
 * Weekly retention: cohort = SGT week (Monday) of a device's first event;
 * week_offset = whole weeks between cohort and activity week.
 */
export function retentionQuery(r: Range) {
  return sql`
    with firsts as (
      select device_id, date_trunc('week', min(${sgt(sql`ts`)}))::date as cohort
      from event_log where device_id is not null group by 1),
    activity as (
      select distinct e.device_id, date_trunc('week', ${sgt(sql`e.ts`)})::date as week
      from event_log e where e.device_id is not null and e.ts < ${r.to.toISOString()}::timestamptz)
    select to_char(f.cohort, 'YYYY-MM-DD') as cohort,
           ((a.week - f.cohort) / 7)::int as week_offset,
           count(distinct a.device_id)::int as users
    from firsts f join activity a on a.device_id = f.device_id
    where f.cohort >= date_trunc('week', ${sgt(sql`${r.from.toISOString()}::timestamptz`)})::date
    group by 1, 2 order by 1, 2`;
}

/** Ordered funnel: page_view → prediction_view → planner_query → app_installed. */
export function funnelQuery(r: Range) {
  const to = r.to.toISOString();
  const step = (name: string, prev: string) => sql`
    select e.device_id, min(e.ts) as t from event_log e
    join ${sql.raw(prev)} p on p.device_id = e.device_id and e.ts >= p.t
    where e.name = ${name} and e.ts < ${to}::timestamptz group by 1`;
  return sql`
    with s1 as (
      select device_id, min(ts) as t from event_log
      where ${inRange(r)} and name = 'page_view' and device_id is not null group by 1),
    s2 as (${step("prediction_view", "s1")}),
    s3 as (${step("planner_query", "s2")}),
    s4 as (${step("app_installed", "s3")})
    select (select count(*) from s1)::int as landing,
           (select count(*) from s2)::int as prediction_view,
           (select count(*) from s3)::int as planner_query,
           (select count(*) from s4)::int as install`;
}

export function webVitalsQuery(r: Range) {
  return sql`
    select props->>'metric' as metric,
           percentile_cont(0.75) within group (order by (props->>'value')::float)::float as p75,
           count(*)::int as n
    from event_log where ${inRange(r)} and name = 'web_vital' group by 1 order by 1`;
}

export function apiLatencyQuery(r: Range) {
  return sql`
    select route,
           percentile_cont(0.5) within group (order by ms)::float as p50,
           percentile_cont(0.95) within group (order by ms)::float as p95,
           count(*)::int as n
    from api_metric where ${inRange(r)} group by 1 order by 1`;
}

export function accuracyQuery(r: Range, by: "line" | "station" | "band") {
  const col = sql.raw(by);
  return sql`
    select ${col} as key, count(*) filter (where hit is not null)::int as scored,
           count(*) filter (where hit)::int as hits
    from prediction_check
    where boarded_at >= ${r.from.toISOString()}::timestamptz and boarded_at < ${r.to.toISOString()}::timestamptz
    group by 1 order by 1`;
}

/** Exposed devices per variant and conversions after exposure. */
export function experimentResultsQuery(r: Range, experimentKey: string) {
  const to = r.to.toISOString();
  return sql`
    with exposed as (
      select device_id, props->>'variant' as variant, min(ts) as t from event_log
      where ${inRange(r)} and name = 'experiment_exposure' and props->>'experiment_id' = ${experimentKey}
        and device_id is not null group by 1, 2)
    select x.variant,
           count(distinct x.device_id)::int as exposed,
           count(distinct e.device_id) filter (where e.name = 'planner_query')::int as planner,
           count(distinct e.device_id) filter (where e.name = 'app_installed')::int as installs,
           count(distinct e.device_id) filter (where e.name = 'newsletter_signup')::int as newsletter
    from exposed x
    left join event_log e on e.device_id = x.device_id and e.ts >= x.t and e.ts < ${to}::timestamptz
      and e.name in ('planner_query', 'app_installed', 'newsletter_signup')
    group by 1 order by 1`;
}

/** KOL funnel: visits → planner use → install → active again within 7 days. */
export function kolFunnelQuery(r: Range) {
  return sql`
    with landed as (
      select props->>'kol_handle' as handle, device_id, min(ts) as t from event_log
      where ${inRange(r)} and name = 'kol_landing' and device_id is not null group by 1, 2)
    select l.handle,
           count(distinct l.device_id)::int as visits,
           count(distinct l.device_id) filter (where exists (
             select 1 from event_log e where e.device_id = l.device_id and e.name = 'planner_query' and e.ts >= l.t))::int as planner,
           count(distinct l.device_id) filter (where exists (
             select 1 from event_log e where e.device_id = l.device_id and e.name = 'app_installed' and e.ts >= l.t))::int as installs,
           count(distinct l.device_id) filter (where exists (
             select 1 from event_log e where e.device_id = l.device_id
               and ${sgt(sql`e.ts`)}::date > ${sgt(sql`l.t`)}::date
               and e.ts < l.t + interval '7 days'))::int as active_7d
    from landed l group by 1 order by 2 desc, 1`;
}

export function campaignPerformanceQuery(r: Range) {
  return sql`
    select utm_campaign as campaign, utm_source as source, utm_medium as medium,
           count(distinct session_id)::int as sessions,
           count(distinct device_id)::int as users,
           count(*) filter (where name = 'planner_query')::int as planner_queries,
           count(*) filter (where name = 'app_installed')::int as installs
    from event_log where ${inRange(r)} and utm_campaign is not null
    group by 1, 2, 3 order by 4 desc, 1`;
}

export function mediaKitQuery(to: Date) {
  const t = to.toISOString();
  return sql`
    select
      (select count(distinct device_id) from event_log where device_id is not null and ts >= ${t}::timestamptz - interval '30 days' and ts < ${t}::timestamptz)::int as users,
      (select count(distinct session_id) from event_log where session_id is not null and ts >= ${t}::timestamptz - interval '30 days' and ts < ${t}::timestamptz)::int as sessions,
      (select count(*) from event_log where name = 'page_view' and ts >= ${t}::timestamptz - interval '30 days' and ts < ${t}::timestamptz)::int as page_views`;
}

export function feedbackSummaryQuery(r: Range) {
  return sql`
    select
      (select count(*) from feedback where ${inRange(r)})::int as feedback_count,
      (select round(avg(rating)::numeric, 2) from feedback where ${inRange(r)})::float as avg_rating,
      (select count(*) from nps_response where ${inRange(r)})::int as nps_count,
      (select round((100.0 * (count(*) filter (where score >= 9) - count(*) filter (where score <= 6)) / nullif(count(*), 0))::numeric, 1)
         from nps_response where ${inRange(r)})::float as nps`;
}

/** Whitelisted CSV exports (raw tables within the range). */
export const EXPORTS = {
  event_log: sql`select id, ts, name, device_id, session_id, aggregate_only, user_type, route, referrer, props, utm_source, utm_medium, utm_campaign, kol_handle, standalone, language, country, city, device_type from event_log`,
  feedback: sql`select id, ts, rating, category, text, route, language, user_type from feedback`,
  nps_response: sql`select id, ts, score, comment from nps_response`,
  observation: sql`select id, station, line, direction, captured_at as ts, minutes, source, status from observation`,
  prediction_check: sql`select id, line, station, direction, band, boarded_at as ts, predicted_at, kind, basis, confidence, error_min, hit from prediction_check`,
  api_metric: sql`select id, ts, route, ms, status from api_metric`,
  campaign: sql`select id, name, source, medium, campaign, content, term, campaign_id, url, created_at as ts from campaign`,
} as const;
export type ExportName = keyof typeof EXPORTS;

export function exportQuery(name: ExportName, r: Range) {
  return sql`select * from (${EXPORTS[name]}) x where ${inRange(r)} order by ts limit 50000`;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v == null ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formulas and quote.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}
