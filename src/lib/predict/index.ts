/**
 * Predictor v2 — next trains for one platform direction at `now`:
 *  1. Same-day anchor — a real train known today at this platform: from a
 *     board reading here, someone boarding / getting off here, or the same
 *     train seen at another station on the line (propagated by ride times,
 *     exact ≤ 2 stops away, then ±1 min per 4 stops). Recorded within the
 *     last 90 min. Other trains are filled in by the gap between trains.
 *  2. Learned band (per platform/direction, day type and 30-min band, from
 *     every known train on earlier days): when clock times repeat day to
 *     day, project them; when they drift, show a range.
 *  3. Not enough days yet: the v0 clock-time repeat outside the editable
 *     unstable windows (admin windows always force ranges), else a range by
 *     the usual gap (learned, else observed on the line, else LTA bands).
 */
import { getLine, inService } from "../network";
import { MINUTE, sgtClock, sgtDate } from "../time";
import { bandHeadway, inUnstableWindow, readingHeadway } from "./bands";
import { projectHistorical } from "./historical";
import { band30Key, learnBand, repeatArrivals, type BandStats } from "./learn";
import { knownTrainsAt, type KnownTrain, type TrainSighting } from "./sightings";
import type { Arrival, Confidence, Observation, Prediction, UnstableWindow } from "./types";

export * from "./types";
export { BANDS, DEFAULT_UNSTABLE_WINDOWS, bandHeadway, inUnstableWindow, timeBand, readingHeadway } from "./bands";
export { projectHistorical } from "./historical";
export type { KnownTrain, TrainSighting, SightingKind } from "./sightings";

export const SAME_DAY_WINDOW_MIN = 90;
/** Trains known further ahead than this (seen far up the line) are not used yet. */
export const SAME_DAY_AHEAD_MIN = 60;
/** A historical anchor further than this from now in time-of-day is ignored. */
export const HISTORICAL_MAX_GAP_MIN = 120;
const ARRIVALS_SHOWN = 3;
const GRACE = 0.25 * MINUTE;

export type PredictInput = {
  line: string;
  direction: string;
  station: string;
  now: number;
  /** Readings for this platform (any day), plus same-line readings for gaps and propagation. */
  observations: Observation[];
  /** Boarding / getting-off sightings on the line (any day). */
  sightings?: TrainSighting[];
  unstableWindows?: UnstableWindow[];
  /** True when the windows were edited in admin: they then win over a learned "repeats". */
  windowsCustom?: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/* Known trains per platform are reused across calls with the same data (planner, boards). */
const NO_SIGHTINGS: TrainSighting[] = [];
const trainCache = new WeakMap<Observation[], WeakMap<TrainSighting[], Map<string, KnownTrain[]>>>();
export function platformTrains(input: Pick<PredictInput, "line" | "direction" | "station" | "observations" | "sightings">): KnownTrain[] {
  const sightings = input.sightings ?? NO_SIGHTINGS;
  let inner = trainCache.get(input.observations);
  if (!inner) trainCache.set(input.observations, (inner = new WeakMap()));
  let map = inner.get(sightings);
  if (!map) inner.set(sightings, (map = new Map()));
  const k = `${input.station}|${input.line}|${input.direction}`;
  let trains = map.get(k);
  if (!trains) map.set(k, (trains = knownTrainsAt(input, sightings, input.observations)));
  return trains;
}

/** Learned band stats for a platform at `now` (memoised alongside the trains). */
const learnCache = new WeakMap<KnownTrain[], Map<string, BandStats>>();
export function platformBand(trains: KnownTrain[], now: number, fallbackHeadway?: number): BandStats {
  let map = learnCache.get(trains);
  if (!map) learnCache.set(trains, (map = new Map()));
  const k = `${sgtDate(now)}|${band30Key(now)}|${fallbackHeadway ?? ""}`;
  let stats = map.get(k);
  if (!stats) map.set(k, (stats = learnBand(trains, now, fallbackHeadway)));
  return stats;
}

function arrivalsFrom(times: number[], now: number): Arrival[] {
  return times
    .filter((t) => t >= now - GRACE)
    .slice(0, ARRIVALS_SHOWN)
    .map((at) => ({ at, inMin: round1(Math.max(0, (at - now) / MINUTE)) }));
}

/**
 * Known train times plus the trains in between: gaps wider than 1.5× the
 * usual gap are filled, trains before the first known one (if it is still
 * to come) are stepped back to now, and trains after the last stepped on.
 */
export function fillTimes(known: number[], headwayMin: number, now: number, count = ARRIVALS_SHOWN): number[] {
  const step = Math.max(1, headwayMin) * MINUTE;
  const sorted = [...new Set(known)].sort((a, b) => a - b);
  if (!sorted.length) return [];
  const out = [...sorted];
  for (let i = 1; i < sorted.length; i++)
    for (let t = sorted[i - 1] + step; sorted[i] - sorted[i - 1] > 1.5 * step && t < sorted[i] - 0.5 * step; t += step) out.push(t);
  if (sorted[0] > now) for (let t = sorted[0] - step, k = 0; t >= now - GRACE && k < count; t -= step, k++) out.push(t);
  let last = sorted[sorted.length - 1];
  while (out.filter((t) => t >= now - GRACE).length < count) out.push((last += step));
  return out.sort((a, b) => a - b);
}

/** Usual gap from today's board readings among the anchoring trains. */
function sameDayGap(trains: KnownTrain[]): number | null {
  const groups = new Map<string, number[]>();
  for (const t of trains) {
    if (t.kind !== "board_reading") continue;
    const k = `${t.origin}|${t.seenAt}`;
    groups.set(k, [...(groups.get(k) ?? []), t.at]);
  }
  const freshest = [...groups.entries()].sort((a, b) => Number(b[0].split("|")[1]) - Number(a[0].split("|")[1]))[0];
  if (!freshest || freshest[1].length < 2) return null;
  const minutes = freshest[1].sort((a, b) => a - b).map((t) => (t - freshest[1][0]) / MINUTE);
  return readingHeadway({ minutes });
}

export function predict(input: PredictInput): Prediction {
  const { line, direction, station, now } = input;
  const windows = input.unstableWindows;
  const lineInfo = getLine(line);
  const band = bandHeadway(input.observations, line, direction, now);
  const trains = platformTrains(input);
  const learned = platformBand(trains, now, band.headway);
  const windowUnstable = inUnstableWindow(now, line, windows);
  const unstable = learned.stability === "drifts" || (windowUnstable && (learned.stability !== "repeats" || Boolean(input.windowsCustom)));
  const usualGap = learned.headway ?? band.headway;
  const gapSource = learned.headway != null || band.source === "observed" ? "observed" : "fallback";
  const common = { band: band.band, unstable, stability: learned.stability };

  if (lineInfo && !inService(lineInfo, now))
    return {
      kind: "closed",
      arrivals: [],
      headwayMin: usualGap,
      waitMin: { min: 0, max: 0 },
      confidence: "high",
      basis: "closed",
      reason: { code: "not_running", params: {} },
      ...common,
    };

  // 1. Same-day anchor: real trains known today (here or further along the line).
  const today = sgtDate(now);
  const recent = trains.filter(
    (t) =>
      sgtDate(t.seenAt) === today &&
      t.seenAt <= now + GRACE &&
      now - t.seenAt <= SAME_DAY_WINDOW_MIN * MINUTE &&
      t.at <= now + SAME_DAY_AHEAD_MIN * MINUTE &&
      now - t.at <= SAME_DAY_WINDOW_MIN * MINUTE,
  );
  if (recent.length) {
    const anchor = [...recent].sort((a, b) => a.spreadMin - b.spreadMin || a.hops - b.hops || b.seenAt - a.seenAt)[0];
    const headway = sameDayGap(recent) ?? usualGap;
    const times = fillTimes(
      recent.map((t) => t.at),
      headway,
      now,
    );
    const minutes = Math.max(0, Math.round((now - anchor.seenAt) / MINUTE));
    const reason: Prediction["reason"] =
      anchor.hops > 0
        ? { code: "seen_elsewhere", params: { station: anchor.origin, minutes, hops: anchor.hops } }
        : anchor.kind === "board_reading"
          ? { code: "reading_ago", params: { minutes } }
          : { code: "boarded_ago", params: { minutes } };
    const spread = Math.max(0, ...recent.filter((t) => t.at >= now - GRACE).slice(0, ARRIVALS_SHOWN).map((t) => t.spreadMin), anchor.spreadMin);
    return {
      kind: "times",
      arrivals: arrivalsFrom(times, now),
      headwayMin: round1(headway),
      waitMin: { min: 0, max: round1(headway) },
      confidence: spread === 0 ? "high" : "medium",
      basis: "same_day",
      reason,
      ...common,
      anchorAt: anchor.seenAt,
      spreadMin: spread,
      anchorKind: anchor.kind,
      ...(anchor.hops > 0 ? { anchorStation: anchor.origin } : {}),
    };
  }

  const range = (confidence: Confidence, code: "unstable_window" | "observed_gap" | "typical_gap"): Prediction => ({
    kind: "range",
    arrivals: [],
    headwayMin: round1(usualGap),
    waitMin: { min: 0, max: Math.ceil(usualGap) },
    confidence,
    basis: "band",
    reason: { code, params: { headway: round1(usualGap), count: learned.headway != null ? learned.gaps : band.count } },
    ...common,
  });

  if (!unstable) {
    // 2. Learned: this half hour's clock times repeat day to day.
    const repeat = repeatArrivals(learned, now, ARRIVALS_SHOWN);
    if (repeat.length)
      return {
        kind: "times",
        arrivals: arrivalsFrom(repeat, now),
        headwayMin: round1(learned.headway!),
        waitMin: { min: 0, max: round1(learned.headway!) },
        confidence: learned.days >= 5 ? "high" : "medium",
        basis: "historical",
        reason: { code: "repeats", params: { days: learned.days } },
        ...common,
      };

    // 3. Not enough days to tell: v0 clock-time repeat from another day's reading.
    if (learned.stability === "unknown") {
      const platform = input.observations.filter(
        (o) => o.status === "approved" && o.line === line && o.direction === direction && o.station === station && o.minutes.length > 0 && sgtDate(o.capturedAt) !== today,
      );
      const projection = projectHistorical(platform, now, usualGap);
      if (projection && projection.anchorGapMin <= HISTORICAL_MAX_GAP_MIN) {
        const first = now + projection.minsToNext * MINUTE;
        const times = Array.from({ length: ARRIVALS_SHOWN }, (_, i) => first + i * projection.headway * MINUTE);
        // Another day's clock times are never as good as today's reading.
        const confidence: Confidence = projection.confidence === "high" ? "medium" : projection.confidence;
        return {
          kind: "times",
          arrivals: arrivalsFrom(times, now),
          headwayMin: round1(projection.headway),
          waitMin: { min: 0, max: round1(projection.headway) },
          confidence,
          basis: "historical",
          reason: { code: "historical_anchor", params: { clock: sgtClock(projection.anchor.capturedAt), gap: projection.anchorGapMin } },
          ...common,
          anchorAt: projection.anchor.capturedAt,
        };
      }
    }
  }

  if (unstable) return range(gapSource === "observed" ? "medium" : "low", "unstable_window");
  return range(gapSource === "observed" ? "medium" : "low", gapSource === "observed" ? "observed_gap" : "typical_gap");
}
