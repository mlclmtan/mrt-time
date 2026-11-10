/**
 * Port of v0 `lib/predict.js` (predictDirection): historical clock-time
 * repeat. Each reading tells us when the next train actually arrived
 * (capture time + minutes shown) and the local headway. Schedules repeat by
 * time-of-day and day-type, so pick the reading whose capture time-of-day is
 * nearest to now (same day-type preferred) and step its arrival forward by
 * the headway to the first train at/after now.
 */
import { circularDelta, dayType, median, sgtMinuteOfDay } from "../time";
import { readingHeadway } from "./bands";
import type { Confidence, Observation } from "./types";

export const V0_DEFAULT_HEADWAY = 5;
/** Another day's reading counts as "the same time of day" within this many minutes. */
export const SAME_TIME_OF_DAY_MIN = 30;

/**
 * Confidence label for times from another day's reading (never "high":
 * that is for today's trains). "Medium" only at the same time of day
 * (≤ 30 min, same day type) or when the half hour is marked repeating;
 * a reading from another day at a different time of day is "low".
 */
export function historicalAnchorConfidence(p: Pick<HistoricalProjection, "anchorGapMin" | "dayTypeMatch">, repeating = false): Confidence {
  if (repeating) return "medium";
  return p.anchorGapMin <= SAME_TIME_OF_DAY_MIN && p.dayTypeMatch ? "medium" : "low";
}

export type HistoricalProjection = {
  minsToNext: number;
  minsToNextNext: number;
  headway: number;
  confidence: Confidence;
  anchor: Observation;
  anchorGapMin: number;
  dayTypeMatch: boolean;
  sampleCount: number;
};

type Enriched = {
  obs: Observation;
  captureTod: number;
  weekend: boolean;
  arrivalTod: number;
  headway: number | null;
};

function enrich(obs: Observation): Enriched {
  const captureTod = sgtMinuteOfDay(obs.capturedAt);
  return {
    obs,
    captureTod,
    weekend: dayType(obs.capturedAt) === "weekend",
    arrivalTod: captureTod + obs.minutes[0],
    headway: readingHeadway(obs),
  };
}

export function projectHistorical(
  observations: Observation[],
  now: number,
  fallbackHeadway?: number,
): HistoricalProjection | null {
  const usable = observations.filter((o) => o.minutes.length > 0);
  if (!usable.length) return null;
  const enriched = usable.map(enrich);
  const nowTod = sgtMinuteOfDay(now);
  const nowWeekend = dayType(now) === "weekend";

  const sameType = enriched.filter((o) => o.weekend === nowWeekend);
  const pool = sameType.length ? sameType : enriched;
  const dayTypeMatch = sameType.length > 0;

  let anchor = pool[0];
  let best = Math.abs(circularDelta(pool[0].captureTod, nowTod));
  for (const o of pool) {
    const d = Math.abs(circularDelta(o.captureTod, nowTod));
    if (d < best) {
      best = d;
      anchor = o;
    }
  }

  const headway =
    anchor.headway ??
    median(enriched.map((o) => o.headway)) ??
    fallbackHeadway ??
    V0_DEFAULT_HEADWAY;

  // Same arithmetic as v0: steps of the headway from the anchor arrival.
  const gap = nowTod - anchor.arrivalTod;
  let k = Math.ceil(gap / headway);
  let minsToNext = k * headway - gap;
  if (minsToNext < -1e-6) {
    k += 1;
    minsToNext = k * headway - gap;
  }

  const anchorGap = Math.abs(circularDelta(anchor.captureTod, nowTod));
  let confidence: Confidence = "low";
  if (anchorGap <= 30 && dayTypeMatch) confidence = "high";
  else if (anchorGap <= 120) confidence = "medium";

  return {
    minsToNext: Math.max(0, minsToNext),
    minsToNextNext: Math.max(0, minsToNext + headway),
    headway,
    confidence,
    anchor: anchor.obs,
    anchorGapMin: Math.round(anchorGap),
    dayTypeMatch,
    sampleCount: usable.length,
  };
}
