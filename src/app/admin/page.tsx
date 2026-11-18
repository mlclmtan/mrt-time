import { desc, eq } from "drizzle-orm";
import { getT } from "@/lib/i18n/server";
import { dbConfigured, getDb } from "@/lib/db";
import { observation, sandboxRun } from "@/lib/db/schema";
import * as q from "@/lib/analytics/aggregates";
import { parseRange } from "@/lib/server/admin";
import { getSymptomsReport } from "@/lib/analytics/symptoms";
import { RangeForm } from "@/components/admin/range-form";
import { BarList, Card, CohortTable, DataTable, FunnelBars, Heatmap, LineChart, StatCard } from "@/components/admin/charts";

type KV = { key: string; n: number };

export default async function AdminOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await getT();
  const sp = await searchParams;
  const range = parseRange(sp.from as string | undefined, sp.to as string | undefined);
  if (!dbConfigured()) return <p className="text-muted">{t("common.notConfigured")}</p>;
  const db = getDb();
  const run = <R,>(query: ReturnType<typeof q.dauQuery>) => q.runRows<R>(db, query).catch(() => [] as R[]);
  const csv = (table: string) => `/api/admin/export?table=${table}&from=${range.fromDate}&to=${range.toDate}`;

  const [active, nvr, sessions, dau, pages, stations, journeys, referrers, utm, geo, devices, heat, retention, funnel, vitals, latency, accuracy, campaigns, kols, feedback, queue, sandbox, health] =
    await Promise.all([
      run<{ dau: number; wau: number; mau: number }>(q.activeUsersQuery(range.to)),
      run<{ new_users: number; returning_users: number }>(q.newVsReturningQuery(range)),
      run<{ sessions: number; avg_engaged_sec: number; page_views: number; anonymous_page_views: number }>(q.sessionsQuery(range)),
      run<{ day: string; users: number }>(q.dauQuery(range)),
      run<KV>(q.topQuery(range, "route")),
      run<KV>(q.topQuery(range, "station")),
      run<KV>(q.topQuery(range, "journey")),
      run<KV>(q.topQuery(range, "referrer")),
      run<KV>(q.topQuery(range, "utm")),
      run<KV>(q.topQuery(range, "geo")),
      run<KV>(q.topQuery(range, "device")),
      run<{ dow: number; hour: number; n: number }>(q.heatmapQuery(range)),
      run<{ cohort: string; week_offset: number; users: number }>(q.retentionQuery(range)),
      run<{ landing: number; prediction_view: number; planner_query: number; install: number }>(q.funnelQuery(range)),
      run<{ metric: string; p75: number; n: number }>(q.webVitalsQuery(range)),
      run<{ route: string; p50: number; p95: number; n: number; err5xx?: number }>(q.apiLatencyQuery(range)),
      run<{ key: string; scored: number; hits: number }>(q.accuracyQuery(range, "line")),
      run<Record<string, unknown>>(q.campaignPerformanceQuery(range)),
      run<Record<string, unknown>>(q.kolFunnelQuery(range)),
      run<{ feedback_count: number; avg_rating: number | null; nps_count: number; nps: number | null }>(q.feedbackSummaryQuery(range)),
      db.select().from(observation).where(eq(observation.status, "pending")).orderBy(desc(observation.createdAt)).limit(10).catch(() => []),
      db.select().from(sandboxRun).orderBy(desc(sandboxRun.ranAt)).limit(7).catch(() => []),
      getSymptomsReport(db, {
        from: new Date(range.to.getTime() - 7 * 24 * 3600 * 1000),
        to: range.to,
      }).catch(() => ({
        window: { from: "", to: "" },
        findings: [],
        counts: { client_error: 0, unclean_exit: 0, tap_queue_failures: 0 },
      })),
    ]);
  const a = active[0] ?? { dau: 0, wau: 0, mau: 0 };
  const s = sessions[0] ?? { sessions: 0, avg_engaged_sec: 0, page_views: 0, anonymous_page_views: 0 };
  const n = nvr[0] ?? { new_users: 0, returning_users: 0 };
  const f = funnel[0] ?? { landing: 0, prediction_view: 0, planner_query: 0, install: 0 };
  const fb = feedback[0];

  return (
    <div className="space-y-4">
      <RangeForm t={t} from={range.fromDate} to={range.toDate} />

      {/* Health section */}
      <div className="space-y-3 rounded-2xl border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-ink">Health & Symptoms (7d)</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="chip border border-line bg-panel-2 font-mono">
              client_error: {health.counts.client_error}
            </span>
            <span className="chip border border-line bg-panel-2 font-mono">
              unclean_exit: {health.counts.unclean_exit}
            </span>
            <span className="chip border border-line bg-panel-2 font-mono">
              tap_queue failures: {health.counts.tap_queue_failures}
            </span>
          </div>
        </div>
        {health.findings.length === 0 ? (
          <p className="text-sm text-muted">No active health issues detected in the 7-day window.</p>
        ) : (
          <div className="space-y-2">
            {health.findings.map((f, i) => {
              const chipColor =
                f.severity === "high"
                  ? "bg-bad/15 text-bad border-bad/30"
                  : f.severity === "medium"
                    ? "bg-warn/15 text-warn border-warn/30"
                    : "bg-accent/15 text-accent border-accent/30";
              return (
                <div key={i} className="flex flex-col gap-1 rounded-xl border border-line/60 bg-panel-2 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`chip border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${chipColor}`}>
                      {f.severity}
                    </span>
                    <span className="font-semibold text-ink">{f.title}</span>
                  </div>
                  <p className="text-xs text-muted font-mono">{f.evidence}</p>
                  <p className="text-xs text-muted">Next step: {f.next_step}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard label={t("admin.dau")} value={a.dau} />
        <StatCard label={t("admin.wau")} value={a.wau} />
        <StatCard label={t("admin.mau")} value={a.mau} />
        <StatCard label={t("admin.newUsers")} value={n.new_users} />
        <StatCard label={t("admin.returning")} value={n.returning_users} />
        <StatCard label={t("admin.sessions")} value={s.sessions} />
        <StatCard label={t("admin.engaged")} value={s.avg_engaged_sec} />
        <StatCard label={t("admin.pageViews")} value={s.page_views} hint={`${t("admin.anonViews")}: ${s.anonymous_page_views}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("admin.daily")} csv={csv("event_log")}>
          <LineChart points={dau.map((d) => ({ x: d.day, y: d.users }))} />
        </Card>
        <Card title={t("admin.funnel")}>
          <FunnelBars
            steps={[
              { label: t("admin.funnel.landing"), n: f.landing },
              { label: t("admin.funnel.prediction"), n: f.prediction_view },
              { label: t("admin.funnel.planner"), n: f.planner_query },
              { label: t("admin.funnel.install"), n: f.install },
            ]}
          />
        </Card>
        <Card title={t("admin.topPages")}>
          <BarList rows={pages} />
        </Card>
        <Card title={t("admin.topStations")}>
          <BarList rows={stations} />
        </Card>
        <Card title={t("admin.topJourneys")}>
          <BarList rows={journeys} />
        </Card>
        <Card title={t("admin.referrers")}>
          <BarList rows={referrers} />
        </Card>
        <Card title={t("admin.utm")}>
          <BarList rows={utm} />
        </Card>
        <Card title={t("admin.geo")}>
          <BarList rows={geo} />
        </Card>
        <Card title={t("admin.devices")}>
          <BarList rows={devices} />
        </Card>
        <Card title={t("admin.heatmap")}>
          <Heatmap cells={heat} />
        </Card>
        <Card title={t("admin.retention")}>
          <CohortTable rows={retention} weekLabel={(w) => t("admin.week", { n: w })} cohortLabel={t("admin.cohort")} />
        </Card>
        <Card title={t("admin.vitals")}>
          <DataTable rows={vitals.map((v) => ({ metric: v.metric, p75: Math.round(v.p75 * 1000) / 1000, n: v.n }))} />
        </Card>
        <Card title={t("admin.latency")} csv={csv("api_metric")}>
          <DataTable rows={latency.map((l) => ({ route: l.route, p50_ms: Math.round(l.p50), p95_ms: Math.round(l.p95), n: l.n }))} />
        </Card>
        <Card title={t("admin.accuracy")} csv={csv("prediction_check")}>
          <DataTable rows={accuracy.map((r) => ({ line: r.key, hits: r.hits, scored: r.scored, rate: r.scored ? `${Math.round((100 * r.hits) / r.scored)}%` : "—" }))} />
        </Card>
        <Card title={t("admin.queue")} csv={csv("observation")}>
          <DataTable rows={queue.map((o) => ({ id: o.id, station: o.station, direction: o.direction, minutes: o.minutes.join("/"), at: o.capturedAt }))} />
        </Card>
        <Card title={t("admin.campaigns")} csv={csv("campaign")}>
          <DataTable rows={campaigns} />
        </Card>
        <Card title={t("admin.kols")}>
          <DataTable rows={kols} />
        </Card>
        <Card title={t("admin.feedback")}>
          <DataTable rows={fb ? [{ feedback: fb.feedback_count, avg_rating: fb.avg_rating ?? "—", nps_responses: fb.nps_count, nps: fb.nps ?? "—" }] : []} />
        </Card>
        <Card title={t("admin.sandbox")}>
          <DataTable rows={sandbox.map((r) => ({ day: r.day, mode: r.mode, users: r.users, events: r.events, status: r.status }))} />
        </Card>
      </div>
    </div>
  );
}
