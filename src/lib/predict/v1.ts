/**
 * The v1 predictor (v1.2.0, verbatim apart from names), kept as the admin
 * kill switch target ("Predictor: v1" in Admin → Settings). Board readings
 * at this platform only: no sightings, no propagation, no learning.
 *
 * Prediction for one platform direction at `now`:
 *  1. Same-day anchor — an approved reading today at this platform within
 *     90 min: its shown trains are real arrivals; project beyond them by its
 *     headway. High confidence.
 *  2. Otherwise the time-band headway (LTA fallback, overridden by the
 *     observed median once ≥ 2 readings exist).
 *  3. Outside unstable windows, a reading from another day near the same
 *     time-of-day (v0 clock-time repeat) gives clock times; inside an
 *     unstable window we only ever show "every ~N min" and a wait range.
 */
import { getLine, inService } from "../network";
import { MINUTE, sgtClock, sgtDate } from "../time";
import { bandHeadway, inUnstableWindow, readingHeadway } from "./bands";
import { historicalAnchorConfidence, projectHistorical } from "./historical";
import type { Arrival, Confidence, Observation, Prediction, UnstableWindow } from "./types";

const SAME_DAY_WINDOW_MIN = 90;
/** A historical anchor further than this from now in time-of-day is ignored. */
const HISTORICAL_MAX_GAP_MIN = 120;
const ARRIVALS_SHOWN = 3;

export type PredictV1Input = {
  line: string;
  direction: string;
  station: string;
  now: number;
  /** Readings for this platform (any day), plus same-line readings for headways. */
  observations: Observation[];
  unstableWindows?: UnstableWindow[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function arrivalsFrom(times: number[], now: number): Arrival[] {
  return times
    .filter((t) => t >= now - 0.25 * MINUTE)
    .slice(0, ARRIVALS_SHOWN)
    .map((at) => ({ at, inMin: round1(Math.max(0, (at - now) / MINUTE)) }));
}

export function predictV1(input: PredictV1Input): Prediction {
  const { line, direction, station, now } = input;
  const windows = input.unstableWindows;
  const lineInfo = getLine(line);
  const band = bandHeadway(input.observations, line, direction, now);
  const unstable = inUnstableWindow(now, line, windows);

  if (lineInfo && !inService(lineInfo, now))
    return {
      kind: "closed",
      arrivals: [],
      headwayMin: band.headway,
      waitMin: { min: 0, max: 0 },
      confidence: "high",
      basis: "closed",
      reason: { code: "not_running", params: {} },
      band: band.band,
      unstable,
    };

  const platform = input.observations.filter(
    (o) =>
      o.status === "approved" &&
      o.line === line &&
      o.direction === direction &&
      o.station === station &&
      o.minutes.length > 0,
  );

  // 1. Same-day anchor.
  const today = sgtDate(now);
  const sameDay = platform
    .filter(
      (o) =>
        sgtDate(o.capturedAt) === today &&
        o.capturedAt <= now &&
        now - o.capturedAt <= SAME_DAY_WINDOW_MIN * MINUTE,
    )
    .sort((a, b) => b.capturedAt - a.capturedAt)[0];
  if (sameDay) {
    const headway = readingHeadway(sameDay) ?? band.headway;
    const shown = sameDay.minutes.map((m) => sameDay.capturedAt + m * MINUTE);
    const times = [...shown];
    let last = times[times.length - 1];
    while (times.filter((t) => t >= now).length < ARRIVALS_SHOWN) {
      last += headway * MINUTE;
      times.push(last);
    }
    return {
      kind: "times",
      arrivals: arrivalsFrom(times, now),
      headwayMin: round1(headway),
      waitMin: { min: 0, max: round1(headway) },
      confidence: "high",
      basis: "same_day",
      reason: {
        code: "reading_ago",
        params: { minutes: Math.round((now - sameDay.capturedAt) / MINUTE) },
      },
      band: band.band,
      unstable,
      anchorAt: sameDay.capturedAt,
    };
  }

  const range = (confidence: Confidence, code: "unstable_window" | "observed_gap" | "typical_gap"): Prediction => ({
    kind: "range",
    arrivals: [],
    headwayMin: round1(band.headway),
    waitMin: { min: 0, max: Math.ceil(band.headway) },
    confidence,
    basis: "band",
    reason: {
      code,
      params: { headway: round1(band.headway), count: band.count },
    },
    band: band.band,
    unstable,
  });

  // 3. Historical repeat, only outside unstable windows.
  if (!unstable) {
    const others = platform.filter((o) => sgtDate(o.capturedAt) !== today);
    const projection = projectHistorical(others, now, band.headway);
    if (projection && projection.anchorGapMin <= HISTORICAL_MAX_GAP_MIN) {
      const first = now + projection.minsToNext * MINUTE;
      const times = Array.from(
        { length: ARRIVALS_SHOWN },
        (_, i) => first + i * projection.headway * MINUTE,
      );
      // Another day's clock times: medium only at the same time of day, else low.
      const confidence: Confidence = historicalAnchorConfidence(projection);
      return {
        kind: "times",
        arrivals: arrivalsFrom(times, now),
        headwayMin: round1(projection.headway),
        waitMin: { min: 0, max: round1(projection.headway) },
        confidence,
        basis: "historical",
        reason: {
          code: "historical_anchor",
          params: {
            clock: sgtClock(projection.anchor.capturedAt),
            date: sgtDate(projection.anchor.capturedAt),
            gap: projection.anchorGapMin,
          },
        },
        band: band.band,
        unstable,
        anchorAt: projection.anchor.capturedAt,
      };
    }
  }

  // 2. Time-band headway.
  if (unstable) return range(band.source === "observed" ? "medium" : "low", "unstable_window");
  return range(band.source === "observed" ? "medium" : "low", band.source === "observed" ? "observed_gap" : "typical_gap");
}
