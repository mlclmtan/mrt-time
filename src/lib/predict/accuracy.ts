/** Prediction accuracy: compare what we predicted with when the owner boarded. */
import { MINUTE } from "../time";
import { predict } from "./index";
import { timeBand } from "./bands";
import type { TrainSighting } from "./sightings";
import type { Observation, Prediction, UnstableWindow } from "./types";

export const HIT_TOLERANCE_MIN = 1;

export type AccuracyCheck = {
  /** Nearest predicted arrival to the boarding moment (times only). */
  predictedAt: number | null;
  errorMin: number | null;
  /** null when the prediction was a range (not scored as a clock time). */
  hit: boolean | null;
};

export function scorePrediction(prediction: Pick<Prediction, "kind" | "arrivals">, boardedAt: number): AccuracyCheck {
  if (prediction.kind !== "times" || !prediction.arrivals.length)
    return { predictedAt: null, errorMin: null, hit: null };
  let best = prediction.arrivals[0].at;
  for (const a of prediction.arrivals)
    if (Math.abs(a.at - boardedAt) < Math.abs(best - boardedAt)) best = a.at;
  const errorMin = Math.round(((boardedAt - best) / MINUTE) * 10) / 10;
  return { predictedAt: best, errorMin, hit: Math.abs(errorMin) <= HIT_TOLERANCE_MIN };
}

/** How long before a boarding the replayed prediction is taken (you check the board, then board). */
export const BACKTEST_LEAD_MIN = 2;

export type BacktestRow = { line: string; station: string; band: string; hit: boolean | null; errorMin: number | null; basis: string };

/**
 * Sightings as ground truth: for every approved "boarded" sighting, replay
 * the prediction we would have made a couple of minutes before, using only
 * what was known then (and never the boarding itself), and score the
 * nearest predicted train against the real one.
 */
export function backtestSightings(
  sightings: TrainSighting[],
  observations: Observation[],
  opts: { unstableWindows?: UnstableWindow[]; windowsCustom?: boolean; limit?: number } = {},
): BacktestRow[] {
  const targets = sightings
    .filter((s) => s.status === "approved" && s.kind === "boarded")
    .sort((a, b) => b.at - a.at)
    .slice(0, opts.limit ?? 400);
  return targets.map((target) => {
    const now = target.at - BACKTEST_LEAD_MIN * MINUTE;
    const known = sightings.filter((s) => s !== target && (s.seenAt ?? s.at) <= now);
    const readings = observations.filter((o) => o.capturedAt <= now);
    const p = predict({
      line: target.line,
      direction: target.direction,
      station: target.station,
      now,
      observations: readings,
      sightings: known,
      unstableWindows: opts.unstableWindows,
      windowsCustom: opts.windowsCustom,
    });
    const check = scorePrediction(p, target.at);
    return { line: target.line, station: target.station, band: timeBand(target.at), hit: check.hit, errorMin: check.errorMin, basis: p.basis };
  });
}

export type AccuracyRow = { line: string; station: string; band: string; hit: boolean | null };
export type AccuracySummary = { key: string; scored: number; hits: number; rate: number | null };

/** Hit rate grouped by a key (line, station or band). Unscored rows are skipped. */
export function summariseAccuracy(rows: AccuracyRow[], by: "line" | "station" | "band"): AccuracySummary[] {
  const groups = new Map<string, { scored: number; hits: number }>();
  for (const row of rows) {
    if (row.hit == null) continue;
    const g = groups.get(row[by]) ?? { scored: 0, hits: 0 };
    g.scored++;
    if (row.hit) g.hits++;
    groups.set(row[by], g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, ...g, rate: g.scored ? g.hits / g.scored : null }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
