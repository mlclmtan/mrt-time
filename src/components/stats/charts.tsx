/** Tiny server-rendered SVG charts for /me/stats (no client JS). */

export type Series = { label: string; color: string };
export type Point = { label: string; values: (number | null)[] };

const W = 600;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function hasData(points: Point[]): boolean {
  return points.some((p) => p.values.some((v) => v != null));
}
function niceMax(points: Point[]): number {
  const max = Math.max(1, ...points.flatMap((p) => p.values.filter((v): v is number => v != null)));
  const step = max > 60 ? 20 : max > 20 ? 10 : 5;
  return Math.ceil(max / step) * step;
}
const yFor = (v: number, max: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;

export function ChartEmpty({ text }: { text: string }) {
  return (
    <figure className="relative" role="img" aria-label={text}>
      <svg viewBox="0 0 600 120" className="h-24 w-full" aria-hidden>
        <line x1="1" y1="4" x2="1" y2="116" stroke="var(--line)" strokeWidth="2" />
        <line x1="1" y1="116" x2="599" y2="116" stroke="var(--line)" strokeWidth="2" />
      </svg>
      <figcaption className="absolute inset-0 flex items-center justify-center text-sm text-muted">{text}</figcaption>
    </figure>
  );
}

function Grid({ max, unit }: { max: number; unit: string }) {
  const ticks = [0, max / 2, max];
  return (
    <g aria-hidden>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yFor(v, max)} y2={yFor(v, max)} stroke="var(--line)" strokeDasharray={v ? "4 6" : undefined} />
          <text x={PAD.left - 4} y={yFor(v, max) + 3} fontSize="10" textAnchor="end" fill="var(--muted)">
            {Math.round(v)}
          </text>
        </g>
      ))}
      <text x={PAD.left - 4} y={PAD.top - 2} fontSize="9" textAnchor="end" fill="var(--muted)">
        {unit}
      </text>
    </g>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <figcaption className="mt-1 flex gap-4 text-xs text-muted">
      {series.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
          {s.label}
        </span>
      ))}
    </figcaption>
  );
}

/** Which x labels to print so they don't collide (always first and last). */
function labelEvery(n: number): number {
  return Math.max(1, Math.ceil(n / 8));
}

/** Lines with dots, one per series; a missing value breaks the line. */
export function TrendChart({ points, series, label, emptyText, unit }: { points: Point[]; series: Series[]; label: string; emptyText: string; unit: string }) {
  if (!hasData(points)) return <ChartEmpty text={emptyText} />;
  const max = niceMax(points);
  const step = points.length > 1 ? PLOT_W / (points.length - 1) : 0;
  const xFor = (i: number) => PAD.left + (points.length > 1 ? i * step : PLOT_W / 2);
  const every = labelEvery(points.length);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        <Grid max={max} unit={unit} />
        {series.map((s, si) => {
          let d = "";
          let pen = false;
          points.forEach((p, i) => {
            const v = p.values[si];
            if (v == null) {
              pen = false;
              return;
            }
            d += `${pen ? "L" : "M"}${xFor(i).toFixed(1)},${yFor(v, max).toFixed(1)} `;
            pen = true;
          });
          return (
            <g key={s.label}>
              <path d={d.trim()} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" />
              {points.map((p, i) =>
                p.values[si] == null ? null : (
                  <circle key={p.label} cx={xFor(i)} cy={yFor(p.values[si] as number, max)} r="3.5" fill={s.color}>
                    <title>{`${s.label} · ${p.label}: ${p.values[si]} ${unit}`}</title>
                  </circle>
                ),
              )}
            </g>
          );
        })}
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={p.label} x={xFor(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      <Legend series={series} />
    </figure>
  );
}

/** Grouped vertical bars: one group per point, one bar per series. */
export function BarChart({ points, series, label, emptyText, unit }: { points: Point[]; series: Series[]; label: string; emptyText: string; unit: string }) {
  if (!hasData(points)) return <ChartEmpty text={emptyText} />;
  const max = niceMax(points);
  const groupW = PLOT_W / points.length;
  const barW = Math.min(28, (groupW * 0.8) / series.length);
  const every = labelEvery(points.length);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
        <Grid max={max} unit={unit} />
        {points.map((p, i) => {
          const x0 = PAD.left + i * groupW + (groupW - barW * series.length) / 2;
          return (
            <g key={p.label}>
              {series.map((s, si) => {
                const v = p.values[si];
                if (v == null) return null;
                const y = yFor(v, max);
                return (
                  <rect key={s.label} x={x0 + si * barW} y={y} width={Math.max(1, barW - 2)} height={Math.max(0, PAD.top + PLOT_H - y)} rx="2" fill={s.color}>
                    <title>{`${s.label} · ${p.label}: ${v} ${unit}`}</title>
                  </rect>
                );
              })}
              {(i % every === 0 || i === points.length - 1) && (
                <text x={PAD.left + i * groupW + groupW / 2} y={H - 6} fontSize="10" textAnchor="middle" fill="var(--muted)">
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </figure>
  );
}
