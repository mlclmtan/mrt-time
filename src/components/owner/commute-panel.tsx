"use client";
import { DoorOpen } from "lucide-react";
import type { CommuteState, CommuteView, DepartureRow, RideCell } from "@/lib/journey/commute";
import { LINES } from "@/lib/network/data";
import { clock, confidenceClass, reasonText } from "@/lib/format";
import { MINUTE } from "@/lib/time";
import type { T } from "@/lib/i18n";
import { useI18n } from "../i18n";

/** "4:07" (m:ss) under an hour, else whole minutes. */
function countdown(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function LineChip({ line }: { line: string }) {
  const color = LINES[line as keyof typeof LINES]?.color ?? "#888";
  return (
    <span className="chip shrink-0 px-1.5 text-[10px] text-white" style={{ background: color }}>
      {line}
    </span>
  );
}

/** Board clock, or a range in unstable / headway-only windows. */
function boardText(r: RideCell) {
  return r.ranged && r.boardUntil ? `${clock(r.boardAt)}–${clock(r.boardUntil)}` : clock(r.boardAt);
}
function arriveText(t: T, row: DepartureRow) {
  return row.ranged && row.worst > row.best
    ? t("commute.arriveRange", { best: clock(row.best), worst: clock(row.worst) })
    : t("commute.arrive", { time: clock(row.arriveAt) });
}
function catchText(t: T, r: RideCell) {
  if (r.ranged) return t("commute.waitRange", { n: Math.ceil(r.headwayMin ?? 0) });
  if (r.catch === "wait") return t("plan.catch.wait", { n: r.waitMin });
  return r.catch ? t(`plan.catch.${r.catch}`) : "";
}
const catchClass = (r: RideCell) =>
  r.ranged ? "bg-panel-2 text-muted" : r.catch === "tight" ? "bg-bad/15 text-bad" : r.catch === "likely" ? "bg-warn/15 text-warn" : "bg-go/15 text-go";

/** "From the platform screen 12 min ago" (age measured from now) / "Typical gap at this hour · every ~6 min". */
function rideReason(t: T, r: RideCell, now: number, locale: "en" | "zh-Hant") {
  if (!r.reason) return "";
  const fresh = r.reason.code === "reading_ago" || r.reason.code === "boarded_ago" || r.reason.code === "seen_elsewhere";
  if (fresh && r.anchorAt != null)
    return reasonText(t, { code: r.reason.code, params: { ...r.reason.params, minutes: Math.max(0, Math.round((now - r.anchorAt) / MINUTE)) } }, locale);
  const base = reasonText(t, r.reason, locale);
  return r.reason.code === "historical_anchor" || r.headwayMin == null ? base : `${base} · ${t("commute.every", { n: r.headwayMin })}`;
}

/** "Leave now" only in the last 30 s before leave-by. */
export const LEAVE_NOW_MS = 30_000;

/**
 * Header of the pre-departure card: "Leave in m:ss" while leave-by is more
 * than 30 s away, "Leave now" in the last 30 s, "You've missed this one,
 * next: HH:MM" once it has passed.
 */
export function leaveHeader(t: T, rows: DepartureRow[], now: number): string {
  const first = rows[0];
  if (!first || !now) return t("commute.leaveNow");
  const left = first.leaveAt - now;
  if (left > LEAVE_NOW_MS) return t("commute.leaveIn", { time: countdown(left) });
  if (left >= 0) return t("commute.leaveGo");
  const later = rows.find((r) => r.leaveAt > now);
  return later ? t("commute.missed", { time: clock(later.leaveAt) }) : t("commute.missedOnly");
}

const MOVING: readonly CommuteState[] = ["on_board", "between"];

export function CommutePanel({
  view,
  now,
  staleAt,
  tripState,
}: {
  view: CommuteView | null;
  now: number;
  staleAt: number | null;
  /**
   * Where the owner is right now, from the client's resolver (`resolveTrip`,
   * updated on the tap itself — before the server's view catches up, and
   * while offline underground). "finished": the big next-step button asks
   * "Arrived ~10:25?" (v2.2: only there); this card just plans from now.
   */
  tripState?: CommuteState;
}) {
  const { t, locale } = useI18n();
  if (!view) return null;
  const { progress, leaveNow, rows } = view;
  // Finished: the view is the next trip from now (a pre-departure plan).
  const idle = progress.state === "idle" || progress.state === "finished";
  // Waiting for the server to catch up with a just-finished trip: nothing stale.
  if (tripState === "finished" && !idle) return null;
  if (!leaveNow) return <p className="panel p-4 text-sm text-muted">{t("commute.empty")}</p>;
  // On board (or changing trains): no "Next departures" — it would list the
  // train already boarded. Back once the trip is finished or dismissed.
  const moving = MOVING.includes(progress.state) || (tripState != null && MOVING.includes(tripState));
  const departures = moving ? [] : rows;
  const first = rows[0];
  const untilFirst = first ? (first.rides[0]?.boardAt ?? first.leaveAt) - now : 0;
  const ranged = departures.some((r) => r.ranged);

  return (
    <div className="space-y-3" data-commute-state={tripState ?? progress.state}>
      {!idle && (
        <p className="text-sm text-accent">
          {t(`commute.state.${progress.state as Exclude<typeof progress.state, "idle" | "finished">}`, { time: clock(progress.startAt) })}
        </p>
      )}

      <section aria-labelledby="leave-now" className="panel rise p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="leave-now" className="font-semibold tabular" aria-live="off">
            {idle ? leaveHeader(t, rows, now) : t("commute.continueNow")}
          </h2>
          {first && now > 0 && (
            <span className="tabular text-sm text-muted" aria-live="off">
              {idle
                ? t("commute.leaveBy", { time: clock(first.leaveAt) })
                : untilFirst > 0
                  ? t("commute.trainIn", { time: countdown(untilFirst) })
                  : t("commute.leaveGo")}
            </span>
          )}
        </div>
        <p className="led mt-1 text-3xl font-bold">{arriveText(t, leaveNow)}</p>
        <p className="tabular text-xs text-muted">{t("commute.bestWorst", { best: clock(leaveNow.best), worst: clock(leaveNow.worst) })}</p>
        <ul className="mt-3 space-y-2 text-sm">
          {leaveNow.rides.map((r, i) => (
            <li key={`${r.from}-${i}`} className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <LineChip line={r.line} />
                <span className="tabular">
                  {r.from} → {r.to}
                </span>
                <span className="led tabular">{boardText(r)}</span>
                <span className={`chip ${confidenceClass(r.confidence)}`}>{t(`conf.${r.confidence}`)}</span>
              </div>
              <p className="text-xs text-muted">{rideReason(t, r, now || view.generatedAt, locale)}</p>
              {r.tip && (
                // The icon sits on the first line; the whole tip wraps (never cut short).
                <p className="door-tip flex items-start gap-1.5 text-xs leading-5 text-led">
                  <DoorOpen size={16} aria-hidden className="mt-0.5 shrink-0" />
                  <span className="min-w-0 flex-1 break-words whitespace-normal">
                    {t("commute.doors")}: {r.tip}
                  </span>
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {departures.length > 0 && (
        <section aria-labelledby="next-departures" className="panel p-4">
          <h2 id="next-departures" className="font-semibold">
            {t("commute.title")}
          </h2>
          {ranged && <p className="mt-1 text-xs text-warn">{t("commute.ranged")}</p>}
          <ol className="mt-2 divide-y divide-line">
            {departures.map((row) => (
              <li key={row.leaveAt} className="py-2">
                {/* Line 1: leave → arrive. Line 2: board leg 1 → transfer catch → board leg 2. */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="led tabular text-lg font-bold">
                    <span className="sr-only">{t("commute.col.leave")} </span>
                    {clock(row.leaveAt)}
                  </span>
                  <span className="tabular text-sm font-semibold">
                    <span aria-hidden className="mr-1 font-normal text-muted">
                      →
                    </span>
                    <span className="sr-only">{t("commute.col.arrive")} </span>
                    {row.ranged && row.worst > row.best ? `${clock(row.best)}–${clock(row.worst)}` : clock(row.arriveAt)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                  {row.rides.map((r, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span className={`chip ${catchClass(r)}`}>{catchText(t, r)}</span>}
                      <LineChip line={r.line} />
                      <span className="tabular">{boardText(r)}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {staleAt && <p className="text-xs text-warn">{t("commute.stale", { time: clock(view.generatedAt) })}</p>}
    </div>
  );
}
