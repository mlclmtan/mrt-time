import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { localePath, type DictKey, type Locale, type T } from "@/lib/i18n";
import { LINES, getDirection, getPlatform, stationForCode } from "@/lib/network";
import { ownerTripEvents } from "@/lib/server/stats";
import { commuteStats, type Spread } from "@/lib/stats/commute";
import { clockFromMinutes, clockMinutes } from "@/lib/time";
import { BarChart, TrendChart, type Series } from "@/components/stats/charts";
import { StatsTracker } from "@/components/stats/stats-tracker";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const DAYS = 180;

function stationName(code: string, locale: Locale): string {
  return stationForCode(code)?.name[locale] ?? code;
}
function lineColor(code: string): string | undefined {
  const line = getPlatform(code)?.line;
  return line ? LINES[line]?.color : undefined;
}
/** The destination as the platform board shows it ("Pasir Ris"). */
function towards(code: string, direction: string, locale: Locale): string {
  const line = getPlatform(code)?.line;
  return (line && getDirection(line, direction)?.board[locale]) || direction.replace(/^TO_/, "").replace(/_/g, " ").toLowerCase();
}

function Chip({ code }: { code: string }) {
  const color = lineColor(code);
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ background: color ?? "var(--panel-2)" }}>
      {code}
    </span>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="panel space-y-3 p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function SpreadTable({ t, rows }: { t: T; rows: { key: string; where: React.ReactNode; s: Spread }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 pr-3 font-normal">{t("stats.col.where")}</th>
            <th className="py-1 pr-3 font-normal">{t("stats.col.trips")}</th>
            <th className="py-1 pr-3 font-normal">{t("stats.col.usual")}</th>
            <th className="py-1 font-normal">{t("stats.col.range")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line align-top">
              <td className="py-2 pr-3">{r.where}</td>
              <td className="py-2 pr-3">{r.s.count}</td>
              <td className="led py-2 pr-3 font-semibold">{t("stats.min", { n: r.s.median })}</td>
              <td className="py-2 text-muted">{t("stats.range", { min: r.s.min, max: r.s.max })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function StatsPage() {
  const session = await getSession();
  if (session?.user.role !== "owner") redirect("/sign-in");
  const { t, locale } = await getT();
  const events = await ownerTripEvents(session.user.id, DAYS).catch(() => []);
  const stats = commuteStats(events);
  const tripCount = stats.trips.length;
  const min = (n: number | null) => (n == null ? t("stats.noValue") : t("stats.min", { n }));
  const twoSeries: Series[] = [
    { label: t("stats.toWork"), color: "var(--led)" },
    { label: t("stats.toHome"), color: "var(--accent)" },
  ];
  const unit = t("unit.min");
  const best = stats.bestLeave?.best;

  return (
    <div className="space-y-6 pt-6" data-clarity-mask="True">
      <StatsTracker trips={tripCount} />
      <Link href={localePath(locale, "/me")} className="text-sm text-accent underline">
        ← {t("stats.back")}
      </Link>
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">{t("stats.title")}</h1>
        <p className="max-w-2xl text-sm text-muted">{t("stats.intro", { days: DAYS })}</p>
      </div>

      <Section title={t("stats.summary")}>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["stats.trips", String(tripCount)],
              ["stats.usualToWork", min(stats.typical.toWork)],
              ["stats.usualToHome", min(stats.typical.toHome)],
            ] as [DictKey, string][]
          ).map(([key, value]) => (
            <div key={key} className="rounded-lg bg-panel-2 p-3">
              <div className="text-xs text-muted">{t(key)}</div>
              <div className="led text-2xl font-bold">{value}</div>
            </div>
          ))}
        </div>
        {tripCount === 0 && <p className="text-sm text-muted">{t("stats.empty")}</p>}
      </Section>

      <Section title={t("stats.best.title")}>
        {best ? (
          <p className="text-lg">
            {t("stats.best.body", { from: best.slot, to: clockFromMinutes(clockMinutes(best.slot) + 9), n: best.median, count: best.count })}
          </p>
        ) : (
          <p className="text-sm text-muted">{t("stats.best.none")}</p>
        )}
        {stats.bestLeave && (
          <>
            <BarChart
              points={stats.bestLeave.slots.map((s) => ({ label: s.slot, values: [s.enough ? s.median : null] }))}
              series={[{ label: t("stats.toWork"), color: "var(--led)" }]}
              label={t("stats.slot.label")}
              emptyText={t("stats.chart.empty")}
              unit={unit}
            />
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">{t("stats.best.all")}</summary>
              <table className="tabular mt-2 w-full">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-3 font-normal">{t("stats.col.leave")}</th>
                    <th className="py-1 pr-3 font-normal">{t("stats.col.trips")}</th>
                    <th className="py-1 pr-3 font-normal">{t("stats.col.usual")}</th>
                    <th className="py-1 font-normal">{t("stats.col.range")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.bestLeave.slots.map((s) => (
                    <tr key={s.slot} className={`border-t border-line ${s.slot === best?.slot ? "text-led" : ""}`}>
                      <td className="py-1 pr-3">
                        {s.slot}–{clockFromMinutes(clockMinutes(s.slot) + 9)}
                      </td>
                      <td className="py-1 pr-3">{s.count}</td>
                      <td className="py-1 pr-3">{s.enough ? t("stats.min", { n: s.median }) : <span className="text-muted">{t("stats.best.few")}</span>}</td>
                      <td className="py-1 text-muted">{t("stats.range", { min: s.min, max: s.max })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </Section>

      <Section title={t("stats.week.title")}>
        <TrendChart
          points={stats.weekly.map((w) => ({ label: t("stats.week.of", { date: w.weekStart.slice(5) }), values: [w.toWork, w.toHome] }))}
          series={twoSeries}
          label={t("stats.week.label")}
          emptyText={t("stats.chart.empty")}
          unit={unit}
        />
      </Section>

      <Section title={t("stats.weekday.title")}>
        <BarChart
          points={stats.byWeekday.map((d) => ({ label: t(`stats.day.${d.weekday}` as DictKey), values: [d.toWork, d.toHome] }))}
          series={twoSeries}
          label={t("stats.weekday.label")}
          emptyText={t("stats.chart.empty")}
          unit={unit}
        />
      </Section>

      <Section title={t("stats.wait.title")} intro={t("stats.wait.intro")}>
        {stats.waits.length === 0 ? (
          <p className="text-sm text-muted">{t("stats.wait.none")}</p>
        ) : (
          <SpreadTable
            t={t}
            rows={stats.waits.map((w) => ({
              key: `${w.station}|${w.direction ?? ""}`,
              s: w,
              where: (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Chip code={w.station} />
                  <span>{stationName(w.station, locale)}</span>
                  {w.direction && <span className="text-xs text-muted">{t("stats.towards", { place: towards(w.station, w.direction, locale) })}</span>}
                </span>
              ),
            }))}
          />
        )}
      </Section>

      <Section title={t("stats.change.title")} intro={t("stats.change.intro")}>
        {stats.changes.length === 0 ? (
          <p className="text-sm text-muted">{t("stats.change.none")}</p>
        ) : (
          <SpreadTable
            t={t}
            rows={stats.changes.map((c) => ({
              key: c.key,
              s: c,
              where: (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={c.outram ? "font-semibold" : undefined}>{stationName(c.from, locale)}</span>
                  <Chip code={c.from} />
                  <span aria-hidden>→</span>
                  <Chip code={c.to} />
                </span>
              ),
            }))}
          />
        )}
      </Section>

      <Section title={t("stats.ride.title")} intro={t("stats.ride.intro")}>
        {stats.rides.length === 0 ? (
          <p className="text-sm text-muted">{t("stats.ride.none")}</p>
        ) : (
          <SpreadTable
            t={t}
            rows={stats.rides.map((r) => ({
              key: r.key,
              s: r,
              where: (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Chip code={r.from} />
                  <span>{stationName(r.from, locale)}</span>
                  <span aria-hidden>→</span>
                  <Chip code={r.to} />
                  <span>{stationName(r.to, locale)}</span>
                </span>
              ),
            }))}
          />
        )}
      </Section>
    </div>
  );
}
