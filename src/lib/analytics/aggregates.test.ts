/**
 * Admin aggregates on a synthetic event set with known answers, run on real
 * Postgres (PGlite) against the generated migrations.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sgtInstant } from "../time";
import { eventLog, feedback, npsResponse, predictionCheck, apiMetric } from "../db/schema";
import { testDb } from "@/test/pglite";
import * as q from "./aggregates";

let db: Awaited<ReturnType<typeof testDb>>["db"];
const at = (date: string, clock: string) => new Date(sgtInstant(date, clock));
type Row = typeof eventLog.$inferInsert;
const ev = (device: string | null, date: string, clock: string, name: string, extra: Partial<Row> = {}): Row => ({
  ts: at(date, clock),
  name,
  deviceId: device,
  sessionId: device ? `${device}-${date}` : null,
  aggregateOnly: !device,
  route: "/",
  props: {},
  ...extra,
});

// Week of Mon 2026-10-26 and Mon 2026-11-02 (Singapore).
const EVENTS: Row[] = [
  // Device A: first seen week 1; full funnel on Mon 26 Oct; back in week 2.
  ev("dev-a", "2026-10-26", "08:00", "page_view", { props: { page_type: "landing" } }),
  ev("dev-a", "2026-10-26", "08:01", "prediction_view"),
  ev("dev-a", "2026-10-26", "08:02", "planner_query", { utmCampaign: "launch", utmSource: "kol", utmMedium: "kol" }),
  ev("dev-a", "2026-10-26", "08:05", "app_installed"),
  ev("dev-a", "2026-11-03", "08:00", "page_view"),
  // Device B: week 1, stops after a prediction view; never returns.
  ev("dev-b", "2026-10-27", "12:00", "page_view"),
  ev("dev-b", "2026-10-27", "12:01", "prediction_view"),
  // Device C: planner query BEFORE its first prediction view → not counted at step 3.
  ev("dev-c", "2026-10-28", "09:00", "planner_query"),
  ev("dev-c", "2026-10-28", "09:01", "page_view"),
  ev("dev-c", "2026-10-28", "09:02", "prediction_view"),
  // Device D: first seen in week 2.
  ev("dev-d", "2026-11-02", "23:30", "page_view"), // still Monday in SGT
  // Aggregate-only (no consent) rows never count as users.
  ev(null, "2026-10-26", "10:00", "page_view", { origin: "server" }),
  ev(null, "2026-11-02", "10:00", "page_view", { origin: "server" }),
  // Web vitals.
  ev("dev-a", "2026-10-26", "08:00", "web_vital", { props: { metric: "LCP", value: 1000, rating: "good" } }),
  ev("dev-b", "2026-10-27", "12:00", "web_vital", { props: { metric: "LCP", value: 2000, rating: "good" } }),
  ev("dev-c", "2026-10-28", "09:00", "web_vital", { props: { metric: "LCP", value: 3000, rating: "needs-improvement" } }),
  // Experiment: A sees control and converts; B sees countdown and doesn't.
  ev("dev-a", "2026-10-26", "08:00", "experiment_exposure", { props: { experiment_id: "landing_hero", variant: "control" } }),
  ev("dev-b", "2026-10-27", "12:00", "experiment_exposure", { props: { experiment_id: "landing_hero", variant: "countdown" } }),
  // KOL landing for A (converted) and B (not).
  ev("dev-a", "2026-10-26", "07:59", "kol_landing", { props: { kol_handle: "trainfan", code_used: false } }),
  ev("dev-b", "2026-10-27", "11:59", "kol_landing", { props: { kol_handle: "trainfan", code_used: true } }),
  ev("dev-a", "2026-10-29", "08:00", "station_view", { props: { station: "outram-park" } }),
];

beforeAll(async () => {
  ({ db } = await testDb());
  await db.insert(eventLog).values(EVENTS);
  await db.insert(feedback).values([
    { rating: 5, category: "accuracy", ts: at("2026-10-27", "10:00") },
    { rating: 3, category: "design", ts: at("2026-10-28", "10:00") },
  ]);
  await db.insert(npsResponse).values([
    { score: 10, ts: at("2026-10-27", "10:00") },
    { score: 9, ts: at("2026-10-27", "11:00") },
    { score: 3, ts: at("2026-10-28", "10:00") },
    { score: 7, ts: at("2026-10-28", "11:00") },
  ]);
  await db.insert(predictionCheck).values([
    { line: "EWL", station: "EW17", direction: "TO_EAST", band: "weekday_offpeak", boardedAt: at("2026-10-27", "10:00"), kind: "times", basis: "same_day", confidence: "high", hit: true },
    { line: "EWL", station: "EW17", direction: "TO_EAST", band: "weekday_offpeak", boardedAt: at("2026-10-28", "10:00"), kind: "times", basis: "same_day", confidence: "high", hit: false },
    { line: "TEL", station: "TE17", direction: "TO_BAYSHORE", band: "weekday_offpeak", boardedAt: at("2026-10-28", "10:00"), kind: "range", basis: "band", confidence: "low", hit: null },
  ]);
  await db.insert(apiMetric).values(
    [10, 20, 30, 40, 100].map((ms) => ({ route: "/api/predict", ms, status: 200, ts: at("2026-10-27", "10:00") })),
  );
});

const week1 = { from: at("2026-10-26", "00:00"), to: at("2026-11-02", "00:00") };
const twoWeeks = { from: at("2026-10-26", "00:00"), to: at("2026-11-09", "00:00") };

describe("admin aggregates", () => {
  it("DAU counts distinct consenting devices per SGT day", async () => {
    const rows = await q.runRows<{ day: string; users: number }>(db, q.dauQuery(twoWeeks));
    expect(rows).toEqual([
      { day: "2026-10-26", users: 1 },
      { day: "2026-10-27", users: 1 },
      { day: "2026-10-28", users: 1 },
      { day: "2026-10-29", users: 1 },
      { day: "2026-11-02", users: 1 },
      { day: "2026-11-03", users: 1 },
    ]);
    const [active] = await q.runRows<{ dau: number; wau: number; mau: number }>(db, q.activeUsersQuery(at("2026-11-04", "00:00")));
    expect(active).toEqual({ dau: 1, wau: 3, mau: 4 });
  });

  it("funnel is ordered per device", async () => {
    const [f] = await q.runRows(db, q.funnelQuery(week1));
    expect(f).toEqual({ landing: 3, prediction_view: 3, planner_query: 1, install: 1 });
  });

  it("weekly retention cohorts", async () => {
    const rows = await q.runRows(db, q.retentionQuery(twoWeeks));
    expect(rows).toEqual([
      { cohort: "2026-10-26", week_offset: 0, users: 3 },
      { cohort: "2026-10-26", week_offset: 1, users: 1 },
      { cohort: "2026-11-02", week_offset: 0, users: 1 },
    ]);
  });

  it("new vs returning, sessions and page views", async () => {
    const week2 = { from: at("2026-11-02", "00:00"), to: at("2026-11-09", "00:00") };
    const [nr] = await q.runRows(db, q.newVsReturningQuery(week2));
    expect(nr).toEqual({ new_users: 1, returning_users: 1 });
    const [s] = await q.runRows<{ sessions: number; page_views: number; anonymous_page_views: number }>(db, q.sessionsQuery(week1));
    expect(s.sessions).toBe(4);
    expect(s.page_views).toBe(4);
    expect(s.anonymous_page_views).toBe(1);
  });

  it("web vitals p75, latency, accuracy, experiments, KOLs, feedback", async () => {
    expect(await q.runRows(db, q.webVitalsQuery(week1))).toEqual([{ metric: "LCP", p75: 2500, n: 3 }]);
    const [lat] = await q.runRows<{ p50: number; p95: number }>(db, q.apiLatencyQuery(week1));
    expect(lat.p50).toBe(30);
    expect(lat.p95).toBeCloseTo(88, 5);
    expect(await q.runRows(db, q.accuracyQuery(week1, "line"))).toEqual([
      { key: "EWL", scored: 2, hits: 1 },
      { key: "TEL", scored: 0, hits: 0 },
    ]);
    expect(await q.runRows(db, q.experimentResultsQuery(week1, "landing_hero"))).toEqual([
      { variant: "control", exposed: 1, planner: 1, installs: 1, newsletter: 0 },
      { variant: "countdown", exposed: 1, planner: 0, installs: 0, newsletter: 0 },
    ]);
    expect(await q.runRows(db, q.kolFunnelQuery(week1))).toEqual([
      { handle: "trainfan", visits: 2, planner: 1, installs: 1, active_7d: 1 },
    ]);
    const [fb] = await q.runRows(db, q.feedbackSummaryQuery(week1));
    expect(fb).toEqual({ feedback_count: 2, avg_rating: 4, nps_count: 4, nps: 25 });
  });

  it("every dashboard builder runs on Postgres", async () => {
    for (const d of ["route", "station", "journey", "referrer", "utm", "geo", "device"] as const)
      await q.runRows(db, q.topQuery(week1, d));
    expect((await q.runRows<{ n: number }>(db, q.heatmapQuery(week1))).length).toBeGreaterThan(0);
    expect(await q.runRows(db, q.campaignPerformanceQuery(week1))).toEqual([
      { campaign: "launch", source: "kol", medium: "kol", sessions: 1, users: 1, planner_queries: 1, installs: 0 },
    ]);
    const [kit] = await q.runRows(db, q.mediaKitQuery(at("2026-11-04", "00:00")));
    expect(kit).toMatchObject({ users: 4 });
    for (const name of Object.keys(q.EXPORTS) as q.ExportName[]) await q.runRows(db, q.exportQuery(name, week1));
  });

  it("CSV export escapes and neutralises formulas", () => {
    expect(q.toCsv([{ a: "x,y", b: '=HYPERLINK("z")', c: null, d: { k: 1 } }])).toBe(
      'a,b,c,d\n"x,y","\'=HYPERLINK(""z"")",,"{""k"":1}"\n',
    );
  });
});
