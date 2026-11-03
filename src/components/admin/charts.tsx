/** Lightweight server-rendered SVG charts for the admin dashboard. */
import Link from "next/link";
import { getT } from "@/lib/i18n/server";

/** Placeholder with faint axes so an empty range still reads as a chart. */
export async function EmptyChart({ kind = "chart" }: { kind?: "chart" | "table" }) {
  const { t } = await getT();
  return (
    <figure className="relative" role="img" aria-label={t("admin.noData")}>
      {kind === "chart" ? (
        <svg viewBox="0 0 600 120" className="h-24 w-full" aria-hidden>
          <line x1="1" y1="4" x2="1" y2="116" stroke="var(--line)" strokeWidth="2" />
          <line x1="1" y1="116" x2="599" y2="116" stroke="var(--line)" strokeWidth="2" />
          {[29, 58, 87].map((y) => (
            <line key={y} x1="1" y1={y} x2="599" y2={y} stroke="var(--line)" strokeDasharray="4 6" />
          ))}
        </svg>
      ) : (
        <div className="h-16 rounded-lg border border-dashed border-line" aria-hidden />
      )}
      <figcaption className="absolute inset-0 flex items-center justify-center text-sm text-muted">{t("admin.noData")}</figcaption>
    </figure>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="panel flex flex-col p-3">
      {/* Fixed two-line label height keeps the KPI row aligned when labels wrap. */}
      <div className="line-clamp-2 h-8 text-xs leading-4 text-muted" title={label}>
        {label}
      </div>
      <div className="led text-2xl font-bold">{typeof value === "number" ? value.toLocaleString("en-SG") : value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function Card({ title, csv, children }: { title: string; csv?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="mb-2 flex items-center">
        <h2 className="font-semibold">{title}</h2>
        {csv && (
          <Link href={csv} className="ml-auto text-xs text-accent underline" prefetch={false}>
            CSV
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function BarList({ rows }: { rows: { key: string; n: number }[] }) {
  if (!rows.length) return <EmptyChart />;
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex justify-between gap-2">
            <span className="truncate">{r.key || "(none)"}</span>
            <span className="tabular text-muted">{r.n.toLocaleString("en-SG")}</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-full bg-panel-2">
            <div className="h-full rounded-full bg-led/80" style={{ width: `${(100 * r.n) / max}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LineChart({ points, height = 120 }: { points: { x: string; y: number }[]; height?: number }) {
  if (!points.length || points.every((p) => !p.y)) return <EmptyChart />;
  const w = 600;
  const max = Math.max(...points.map((p) => p.y), 1);
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - (p.y / max) * (height - 10)).toFixed(1)}`).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${height}`} className="h-32 w-full" role="img" aria-label="Daily trend">
        <path d={path} fill="none" stroke="var(--led)" strokeWidth="2.5" />
        {points.map((p, i) => (
          <circle key={p.x} cx={i * step} cy={height - (p.y / max) * (height - 10)} r="2.5" fill="var(--led)">
            <title>{`${p.x}: ${p.y}`}</title>
          </circle>
        ))}
      </svg>
      <figcaption className="flex justify-between text-[10px] text-muted">
        <span>{points[0].x}</span>
        <span>max {max}</span>
        <span>{points[points.length - 1].x}</span>
      </figcaption>
    </figure>
  );
}

export function Heatmap({ cells }: { cells: { dow: number; hour: number; n: number }[] }) {
  if (!cells.some((c) => c.n > 0)) return <EmptyChart />;
  const max = Math.max(...cells.map((c) => c.n), 1);
  const get = (d: number, h: number) => cells.find((c) => c.dow === d && c.hour === h)?.n ?? 0;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <svg viewBox="0 0 520 170" className="w-full" role="img" aria-label="Heatmap">
      {days.map((d, di) => (
        <g key={d}>
          <text x="0" y={di * 22 + 15} fontSize="10" fill="var(--muted)">
            {d}
          </text>
          {Array.from({ length: 24 }, (_, h) => {
            const n = get(di + 1, h);
            return (
              <rect key={h} x={30 + h * 20} y={di * 22 + 2} width="18" height="18" rx="3" fill="var(--led)" opacity={n ? 0.12 + (0.88 * n) / max : 0.05}>
                <title>{`${d} ${String(h).padStart(2, "0")}:00 — ${n}`}</title>
              </rect>
            );
          })}
        </g>
      ))}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={30 + h * 20} y="166" fontSize="9" fill="var(--muted)">
          {String(h).padStart(2, "0")}
        </text>
      ))}
    </svg>
  );
}

export function FunnelBars({ steps }: { steps: { label: string; n: number }[] }) {
  if (!steps.some((s) => s.n > 0)) return <EmptyChart />;
  const top = Math.max(steps[0]?.n ?? 0, 1);
  return (
    <ol className="space-y-2 text-sm">
      {steps.map((s, i) => (
        <li key={s.label}>
          <div className="flex justify-between">
            <span>{s.label}</span>
            <span className="tabular text-muted">
              {s.n} {i > 0 && steps[i - 1].n ? `· ${Math.round((100 * s.n) / steps[i - 1].n)}%` : ""}
            </span>
          </div>
          <div className="mt-0.5 h-3 rounded bg-panel-2">
            <div className="h-full rounded bg-accent/80" style={{ width: `${(100 * s.n) / top}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CohortTable({ rows, weekLabel, cohortLabel }: { rows: { cohort: string; week_offset: number; users: number }[]; weekLabel: (n: number) => string; cohortLabel: string }) {
  const cohorts = [...new Set(rows.map((r) => r.cohort))];
  const maxWeek = Math.max(0, ...rows.map((r) => r.week_offset));
  if (!cohorts.length) return <EmptyChart kind="table" />;
  return (
    <div className="overflow-x-auto">
      <table className="tabular text-xs">
        <thead>
          <tr className="text-muted">
            <th className="pr-3 text-left">{cohortLabel}</th>
            {Array.from({ length: maxWeek + 1 }, (_, w) => (
              <th key={w} className="px-2">
                {weekLabel(w)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => {
            const base = rows.find((r) => r.cohort === c && r.week_offset === 0)?.users || 1;
            return (
              <tr key={c}>
                <td className="pr-3">{c}</td>
                {Array.from({ length: maxWeek + 1 }, (_, w) => {
                  const n = rows.find((r) => r.cohort === c && r.week_offset === w)?.users;
                  return (
                    <td key={w} className="px-2 text-center" style={{ background: n ? `rgb(246 195 67 / ${0.1 + (0.6 * n) / base})` : undefined }}>
                      {n == null ? "" : w === 0 ? n : `${Math.round((100 * n) / base)}%`}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <EmptyChart kind="table" />;
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full text-xs">
        <thead>
          <tr className="text-left text-muted">
            {cols.map((c) => (
              <th key={c} className="py-1 pr-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line">
              {cols.map((c) => (
                <td key={c} className="py-1 pr-3">
                  {r[c] == null ? "" : r[c] instanceof Date ? (r[c] as Date).toISOString() : typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
