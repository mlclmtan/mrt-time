/**
 * Symptoms reporting: pure evaluation rules + SQL aggregations.
 * Detects when the app breaks or annoys users, and whether v3 UX changes
 * reduce taps and corrections.
 */
import { sql, type SQL } from "drizzle-orm";
import { apiLatencyQuery, runRows, webVitalsQuery, type Range } from "./aggregates";

export type FindingSeverity = "high" | "medium" | "low";

export type Finding = {
  id: string;
  severity: FindingSeverity;
  title: string;
  evidence: string;
  next_step: string;
};

export const SYMPTOM_THRESHOLDS = {
  clientErrorGroupMin: 3,
  uncleanExitsVisibleMin: 2,
  tapQueueFailedOrDroppedMin: 1,
  apiLatencyP95Ms: 2000,
  api5xxPct: 0.05,
  lcpP75Ms: 2500,
  inpP75Ms: 200,
  clsP75: 0.1,
  longTaskMaxMs: 1000,
  tapCorrectionRatio: 0.3,
  tapCorrectionMinTaps: 10,
  tapUndoRatio: 0.15,
  tripTapPerDayMedianMax: 6,
} as const;

export type SymptomData = {
  clientErrorGroups?: Array<{ msg: string; file?: string | null; line?: number | null; count: number }>;
  uncleanExitsVisible?: number;
  tapQueueFailedOrDropped?: number;
  apiLatencies?: Array<{ route: string; p50: number; p95: number; n: number; err5xx?: number }>;
  webVitals?: Array<{ metric: string; p75: number; n: number }>;
  longTaskMaxMs?: number;
  tripTapCount?: number;
  tapCorrectionCount?: number;
  tapUndoCount?: number;
  tripTapsPerDay?: number[];
};

export function calculateMedian(numbers: number[]): number {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

/** Pure rule engine: evaluates all 9 symptom rules against input metrics. */
export function evaluateSymptoms(data: SymptomData, thresholds = SYMPTOM_THRESHOLDS): Finding[] {
  const findings: Finding[] = [];

  // Rule 1: client_error group (msg+file+line) >= 3 in window -> medium
  for (const group of data.clientErrorGroups ?? []) {
    if (group.count >= thresholds.clientErrorGroupMin) {
      const loc = group.file ? `${group.file}${group.line != null ? `:${group.line}` : ""}` : "unknown location";
      findings.push({
        id: "client_error_repeated",
        severity: "medium",
        title: "Repeated client error",
        evidence: `"${group.msg}" at ${loc} occurred ${group.count} times (threshold: >= ${thresholds.clientErrorGroupMin})`,
        next_step: `Investigate client stack trace and fix error at ${loc}.`,
      });
    }
  }

  // Rule 2: unclean exits while visible >= 2 -> high
  const unclean = data.uncleanExitsVisible ?? 0;
  if (unclean >= thresholds.uncleanExitsVisibleMin) {
    findings.push({
      id: "unclean_exits_visible",
      severity: "high",
      title: "Repeated unclean app exits",
      evidence: `${unclean} unclean exit(s) while page was visible (threshold: >= ${thresholds.uncleanExitsVisibleMin})`,
      next_step: "Review freeze/crash breadcrumbs from unclean_exit events to locate blocking execution or crash points.",
    });
  }

  // Rule 3: tap_queue failed or dropped >= 1 -> high
  const tapQueueFails = data.tapQueueFailedOrDropped ?? 0;
  if (tapQueueFails >= thresholds.tapQueueFailedOrDroppedMin) {
    findings.push({
      id: "tap_queue_failures",
      severity: "high",
      title: "Offline tap queue failure or drop",
      evidence: `${tapQueueFails} tap(s) failed or dropped from offline queue (threshold: >= ${thresholds.tapQueueFailedOrDroppedMin})`,
      next_step: "Verify /api/trip-events and /api/sightings endpoint availability, payload validation, and rate limits.",
    });
  }

  // Rule 4: API route p95 > 2 s or 5xx > 5 % -> medium/high
  for (const api of data.apiLatencies ?? []) {
    const err5xxCount = api.err5xx ?? 0;
    const errRate = api.n > 0 ? err5xxCount / api.n : 0;
    if (errRate > thresholds.api5xxPct) {
      findings.push({
        id: `api_5xx_${api.route}`,
        severity: "high",
        title: `API 5xx rate high: ${api.route}`,
        evidence: `5xx error rate is ${(errRate * 100).toFixed(1)}% (${err5xxCount}/${api.n} calls, threshold: > ${(thresholds.api5xxPct * 100).toFixed(0)}%) on ${api.route}`,
        next_step: `Inspect backend server logs and database errors for ${api.route}.`,
      });
    } else if (api.p95 > thresholds.apiLatencyP95Ms) {
      findings.push({
        id: `api_latency_${api.route}`,
        severity: "medium",
        title: `API latency high: ${api.route}`,
        evidence: `p95 latency is ${Math.round(api.p95)} ms (threshold: > ${thresholds.apiLatencyP95Ms} ms) on ${api.route}`,
        next_step: `Analyze query execution time, connection pooling, and caching for ${api.route}.`,
      });
    }
  }

  // Rule 5: web vitals p75 LCP > 2500 ms, INP > 200 ms, CLS > 0.1 -> medium
  for (const vital of data.webVitals ?? []) {
    if (vital.metric === "LCP" && vital.p75 > thresholds.lcpP75Ms) {
      findings.push({
        id: "web_vital_lcp",
        severity: "medium",
        title: "High LCP (Largest Contentful Paint)",
        evidence: `p75 LCP is ${Math.round(vital.p75)} ms (threshold: > ${thresholds.lcpP75Ms} ms)`,
        next_step: "Optimize initial server response, critical CSS and large component hydration.",
      });
    } else if (vital.metric === "INP" && vital.p75 > thresholds.inpP75Ms) {
      findings.push({
        id: "web_vital_inp",
        severity: "medium",
        title: "High INP (Interaction to Next Paint)",
        evidence: `p75 INP is ${Math.round(vital.p75)} ms (threshold: > ${thresholds.inpP75Ms} ms)`,
        next_step: "Reduce main-thread blocking operations during user interactions and touch handling.",
      });
    } else if (vital.metric === "CLS" && vital.p75 > thresholds.clsP75) {
      findings.push({
        id: "web_vital_cls",
        severity: "medium",
        title: "High CLS (Cumulative Layout Shift)",
        evidence: `p75 CLS is ${vital.p75.toFixed(3)} (threshold: > ${thresholds.clsP75})`,
        next_step: "Provide static size dimensions for dynamic content, boards and banners.",
      });
    }
  }

  // Rule 6: long task max > 1000 ms -> medium
  const maxLongTask = data.longTaskMaxMs ?? 0;
  if (maxLongTask > thresholds.longTaskMaxMs) {
    findings.push({
      id: "long_tasks_jank",
      severity: "medium",
      title: "Main-thread jank (long task > 1000 ms)",
      evidence: `Maximum long task duration is ${Math.round(maxLongTask)} ms (threshold: > ${thresholds.longTaskMaxMs} ms)`,
      next_step: "Break long-running computations into requestAnimationFrame/microtasks.",
    });
  }

  // Rule 7: tap_correction / trip_tap > 30 % (>= 10 taps) -> medium "tap time often wrong"
  const tripTaps = data.tripTapCount ?? 0;
  const corrections = data.tapCorrectionCount ?? 0;
  if (tripTaps >= thresholds.tapCorrectionMinTaps && corrections / tripTaps > thresholds.tapCorrectionRatio) {
    findings.push({
      id: "tap_time_often_wrong",
      severity: "medium",
      title: "Tap time often wrong",
      evidence: `tap_correction / trip_tap is ${((corrections / tripTaps) * 100).toFixed(1)}% (${corrections} corrections / ${tripTaps} taps, threshold: > ${(thresholds.tapCorrectionRatio * 100).toFixed(0)}%)`,
      next_step: "Refine countdowns, arrival predictions, and default timing cues on the Trip screen.",
    });
  }

  // Rule 8: tap_undo / trip_tap > 15 % -> medium
  const undos = data.tapUndoCount ?? 0;
  if (tripTaps > 0 && undos / tripTaps > thresholds.tapUndoRatio) {
    findings.push({
      id: "tap_undo_rate_high",
      severity: "medium",
      title: "Frequent tap undos",
      evidence: `tap_undo / trip_tap is ${((undos / tripTaps) * 100).toFixed(1)}% (${undos} undos / ${tripTaps} taps, threshold: > ${(thresholds.tapUndoRatio * 100).toFixed(0)}%)`,
      next_step: "Evaluate button sizing, touch targets and confirmation prompts to reduce accidental presses.",
    });
  }

  // Rule 9: median trip_tap per trip day > 6 -> low "trip still takes many taps"
  const dailyTaps = data.tripTapsPerDay ?? [];
  if (dailyTaps.length > 0) {
    const med = calculateMedian(dailyTaps);
    if (med > thresholds.tripTapPerDayMedianMax) {
      findings.push({
        id: "trip_many_taps",
        severity: "low",
        title: "Trip still takes many taps",
        evidence: `Median trip_tap per trip day is ${med} (threshold: > ${thresholds.tripTapPerDayMedianMax})`,
        next_step: "Simplify leg transitions and automate next-action inference across transfers.",
      });
    }
  }

  return findings;
}

// SQL Query Builders for Neon/Postgres
const inRange = (r: Range) =>
  sql`ts >= ${r.from.toISOString()}::timestamptz and ts < ${r.to.toISOString()}::timestamptz`;

export function clientErrorGroupsQuery(r: Range) {
  return sql`
    select props->>'msg' as msg,
           props->>'file' as file,
           (props->>'line')::int as line,
           count(*)::int as count
    from event_log
    where ${inRange(r)} and name = 'client_error'
    group by 1, 2, 3
    order by 4 desc`;
}

export function uncleanExitsQuery(r: Range) {
  return sql`
    select count(*)::int as count
    from event_log
    where ${inRange(r)} and name = 'unclean_exit' and (props->>'visible')::boolean = true`;
}

export function tapQueueFailuresQuery(r: Range) {
  return sql`
    select coalesce(sum(case when props->>'action' in ('failed', 'dropped') then coalesce((props->>'count')::int, 1) else 0 end), 0)::int as count
    from event_log
    where ${inRange(r)} and name = 'tap_queue' and props->>'action' in ('failed', 'dropped')`;
}

export function longTasksSummaryQuery(r: Range) {
  return sql`
    select coalesce(max((props->>'max_ms')::float), 0)::float as max_ms
    from event_log
    where ${inRange(r)} and name = 'long_tasks'`;
}

export function uxTelemetrySummaryQuery(r: Range) {
  return sql`
    select
      count(*) filter (where name = 'trip_tap')::int as trip_taps,
      count(*) filter (where name = 'tap_correction')::int as corrections,
      count(*) filter (where name = 'tap_undo')::int as undos
    from event_log
    where ${inRange(r)} and name in ('trip_tap', 'tap_correction', 'tap_undo')`;
}

export function tripTapsPerDayQuery(r: Range) {
  return sql`
    select to_char(((ts) at time zone 'UTC' + interval '8 hours')::date, 'YYYY-MM-DD') as day,
           count(*)::int as taps
    from event_log
    where ${inRange(r)} and name = 'trip_tap'
    group by 1
    order by 1`;
}

export function healthCountsQuery(r: Range) {
  return sql`
    select
      count(*) filter (where name = 'client_error')::int as client_error,
      count(*) filter (where name = 'unclean_exit')::int as unclean_exit,
      coalesce(sum(case when name = 'tap_queue' and props->>'action' in ('failed', 'dropped') then coalesce((props->>'count')::int, 1) else 0 end), 0)::int as tap_queue_failures
    from event_log
    where ${inRange(r)}`;
}

type Executor = { execute: (q: SQL) => Promise<unknown> };

export async function getSymptomsReport(
  db: Executor,
  range: Range,
  thresholds = SYMPTOM_THRESHOLDS,
): Promise<{
  window: { from: string; to: string };
  findings: Finding[];
  counts: { client_error: number; unclean_exit: number; tap_queue_failures: number };
}> {
  const [
    errorGroups,
    uncleanRows,
    tapQueueRows,
    latencyRows,
    vitalRows,
    longTaskRows,
    uxRows,
    dailyRows,
    countRows,
  ] = await Promise.all([
    runRows<{ msg: string; file?: string | null; line?: number | null; count: number }>(db, clientErrorGroupsQuery(range)).catch(() => []),
    runRows<{ count: number }>(db, uncleanExitsQuery(range)).catch(() => [{ count: 0 }]),
    runRows<{ count: number }>(db, tapQueueFailuresQuery(range)).catch(() => [{ count: 0 }]),
    runRows<{ route: string; p50: number; p95: number; n: number; err5xx?: number }>(db, apiLatencyQuery(range)).catch(() => []),
    runRows<{ metric: string; p75: number; n: number }>(db, webVitalsQuery(range)).catch(() => []),
    runRows<{ max_ms: number }>(db, longTasksSummaryQuery(range)).catch(() => [{ max_ms: 0 }]),
    runRows<{ trip_taps: number; corrections: number; undos: number }>(db, uxTelemetrySummaryQuery(range)).catch(() => [{ trip_taps: 0, corrections: 0, undos: 0 }]),
    runRows<{ day: string; taps: number }>(db, tripTapsPerDayQuery(range)).catch(() => []),
    runRows<{ client_error: number; unclean_exit: number; tap_queue_failures: number }>(db, healthCountsQuery(range)).catch(() => [{ client_error: 0, unclean_exit: 0, tap_queue_failures: 0 }]),
  ]);

  const uncleanExitsVisible = uncleanRows[0]?.count ?? 0;
  const tapQueueFailedOrDropped = tapQueueRows[0]?.count ?? 0;
  const longTaskMaxMs = longTaskRows[0]?.max_ms ?? 0;
  const ux = uxRows[0] ?? { trip_taps: 0, corrections: 0, undos: 0 };
  const tripTapsPerDay = dailyRows.map((r) => r.taps);
  const counts = countRows[0] ?? { client_error: 0, unclean_exit: 0, tap_queue_failures: 0 };

  const findings = evaluateSymptoms(
    {
      clientErrorGroups: errorGroups,
      uncleanExitsVisible,
      tapQueueFailedOrDropped,
      apiLatencies: latencyRows,
      webVitals: vitalRows,
      longTaskMaxMs,
      tripTapCount: ux.trip_taps,
      tapCorrectionCount: ux.corrections,
      tapUndoCount: ux.undos,
      tripTapsPerDay,
    },
    thresholds,
  );

  return {
    window: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
    findings,
    counts,
  };
}
