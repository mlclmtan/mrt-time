/** Prediction accuracy: compare what we predicted with when the owner boarded. */
import { MINUTE } from "../time";
import type { Prediction } from "./types";

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
