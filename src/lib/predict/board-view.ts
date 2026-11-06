/**
 * Station-board view-model: what one direction card shows. Always clock
 * times (never an interval on its own):
 *  - "exact": a board reading at this platform today within 90 min.
 *  - "estimate": another day's reading at a similar time, or the typical
 *    gap at this hour placed on a steady grid, shown as "≈HH:MM" with a
 *    ± band. Unstable windows widen the band instead of hiding times.
 * Pure: the client recomputes it every second from a server Prediction.
 */
import { getLine, inService } from "../network";
import { MINUTE, sgtClock, sgtMidnight } from "../time";
import { predict } from "./index";
import type { Observation, Prediction, UnstableWindow } from "./types";

export const BOARD_ARRIVALS = 3;
/** Trains are kept on the card until 30 s after they are due. */
const GRACE_MS = 30_000;

export type BoardArrival = { at: number; clock: string; inMin: number };
export type BoardReason =
  | { code: "reading_ago"; minutes: number }
  | { code: "historical_anchor"; clock: string }
  | { code: "typical_gap"; headway: number }
  | { code: "unstable_gap"; headway: number };

export type DirectionView =
  | { state: "closed" }
  | {
      state: "exact" | "estimate";
      arrivals: BoardArrival[];
      /** ± minutes around estimated clock times (null when exact). */
      plusMinus: number | null;
      headwayMin: number;
      unstable: boolean;
      reason: BoardReason;
    };

const wholeMin = (n: number) => Math.max(1, Math.round(n));

/** ± band for estimates: wider when times shift day to day. */
export function estimateSpread(p: Pick<Prediction, "basis" | "headwayMin" | "unstable" | "confidence">): number {
  const half = Math.ceil(p.headwayMin / 2);
  if (p.basis === "historical") return p.confidence === "low" ? 2 : 1;
  if (p.unstable) return Math.max(3, half + 1);
  return Math.max(1, half);
}

/**
 * Typical-gap estimate with no anchor: trains on a steady grid from the
 * start of service, so the times stay put (and count down) between renders.
 */
export function gridArrivals(headwayMin: number, now: number, line: string | undefined, count = BOARD_ARRIVALS): number[] {
  const h = Math.max(1, headwayMin) * MINUTE;
  const start = getLine(line ?? "")?.serviceStart ?? 5 * 60 + 30;
  let origin = sgtMidnight(now) + start * MINUTE;
  if (origin > now) origin -= 24 * 60 * MINUTE; // after midnight, before service start of the new day
  const k = Math.ceil((now - origin) / h);
  return Array.from({ length: count }, (_, i) => origin + (k + i) * h);
}

function extend(times: number[], headwayMin: number, now: number): number[] {
  const out = times.filter((t) => t >= now - GRACE_MS);
  let last = times[times.length - 1] ?? now;
  const step = Math.max(1, headwayMin) * MINUTE;
  while (out.length < BOARD_ARRIVALS) {
    last += step;
    if (last >= now - GRACE_MS) out.push(last);
  }
  return out.slice(0, BOARD_ARRIVALS);
}

const toArrival = (now: number) => (at: number): BoardArrival => ({ at, clock: sgtClock(at), inMin: Math.max(0, Math.floor((at - now) / MINUTE)) });

export function directionView(p: Prediction, now: number, line?: string): DirectionView {
  if (p.kind === "closed") return { state: "closed" };
  const headwayMin = p.headwayMin || 6;
  const base = { headwayMin, unstable: p.unstable };
  if (p.basis === "same_day") {
    const times = extend(p.arrivals.map((a) => a.at), headwayMin, now);
    return {
      ...base,
      state: "exact",
      plusMinus: null,
      arrivals: times.map(toArrival(now)),
      reason: { code: "reading_ago", minutes: p.anchorAt != null ? Math.max(0, Math.round((now - p.anchorAt) / MINUTE)) : Number(p.reason.params.minutes ?? 0) },
    };
  }
  if (p.basis === "historical" && p.arrivals.length) {
    const times = extend(p.arrivals.map((a) => a.at), headwayMin, now);
    return {
      ...base,
      state: "estimate",
      plusMinus: estimateSpread(p),
      arrivals: times.map(toArrival(now)),
      reason: { code: "historical_anchor", clock: String(p.reason.params.clock ?? "") },
    };
  }
  const times = gridArrivals(headwayMin, now, line);
  return {
    ...base,
    state: "estimate",
    plusMinus: estimateSpread({ ...p, basis: "band" }),
    arrivals: times.map(toArrival(now)),
    reason: { code: p.unstable ? "unstable_gap" : "typical_gap", headway: wholeMin(headwayMin) },
  };
}

/**
 * The visitor's own just-saved reading wins over the server's view until
 * the server has an anchor at least as fresh (so the card turns exact the
 * moment you save, even if the reading still awaits a second opinion).
 */
export function withLocalReading(
  server: Prediction,
  local: Observation | null | undefined,
  ctx: { line: string; direction: string; station: string; now: number; unstableWindows?: UnstableWindow[] },
): Prediction {
  if (!local || local.station !== ctx.station || local.direction !== ctx.direction || local.line !== ctx.line) return server;
  if (server.basis === "same_day" && (server.anchorAt ?? 0) >= local.capturedAt) return server;
  const lineInfo = getLine(ctx.line);
  if (lineInfo && !inService(lineInfo, ctx.now)) return server;
  const mine = predict({ ...ctx, observations: [{ ...local, status: "approved" }] });
  return mine.basis === "same_day" ? mine : server;
}
