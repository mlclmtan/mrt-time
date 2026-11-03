import { clockMinutes, dayType, median, sgtMinuteOfDay } from "../time";
import type { Observation, TimeBandKey, UnstableWindow } from "./types";

/**
 * LTA-published typical frequencies: 2–3 min in weekday peaks
 * (07:00–09:00, 17:00–19:00), 5–7 min otherwise.
 */
export const BANDS: Record<TimeBandKey, { range: [number, number]; fallback: number }> = {
  weekday_am_peak: { range: [2, 3], fallback: 2.5 },
  weekday_pm_peak: { range: [2, 3], fallback: 2.5 },
  weekday_offpeak: { range: [5, 7], fallback: 6 },
  weekend: { range: [5, 7], fallback: 6 },
};

export function timeBand(instant: number): TimeBandKey {
  if (dayType(instant) === "weekend") return "weekend";
  const tod = sgtMinuteOfDay(instant);
  if (tod >= 7 * 60 && tod < 9 * 60) return "weekday_am_peak";
  if (tod >= 17 * 60 && tod < 19 * 60) return "weekday_pm_peak";
  return "weekday_offpeak";
}

/** Owner-observed: weekday 09:15–10:30 clock times don't repeat day to day. */
export const DEFAULT_UNSTABLE_WINDOWS: UnstableWindow[] = [
  { dayType: "weekday", start: "09:15", end: "10:30", line: null, note: "Post-peak thinning; clock times drift day to day" },
];

export function inUnstableWindow(
  instant: number,
  line: string,
  windows: UnstableWindow[] = DEFAULT_UNSTABLE_WINDOWS,
): boolean {
  const tod = sgtMinuteOfDay(instant);
  const type = dayType(instant);
  return windows.some((w) => {
    if (w.line && w.line !== line) return false;
    if (w.dayType !== "all" && w.dayType !== type) return false;
    const start = clockMinutes(w.start);
    const end = clockMinutes(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return start <= end ? tod >= start && tod < end : tod >= start || tod < end;
  });
}

/** Gaps between shown trains of one reading (minutes). */
export function readingGaps(obs: Pick<Observation, "minutes">): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < obs.minutes.length; i++) {
    const gap = obs.minutes[i] - obs.minutes[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  return gaps;
}
export function readingHeadway(obs: Pick<Observation, "minutes">): number | null {
  return median(readingGaps(obs));
}

export type BandHeadway = {
  headway: number;
  source: "observed" | "fallback";
  count: number;
  band: TimeBandKey;
};

/**
 * Headway for the band containing `now`: the median observed gap across
 * approved readings for the same line/direction/band once ≥ 2 readings
 * give one, else the LTA fallback.
 */
export function bandHeadway(
  observations: Observation[],
  line: string,
  direction: string,
  now: number,
): BandHeadway {
  const band = timeBand(now);
  const headways = observations
    .filter(
      (o) =>
        o.status === "approved" &&
        o.line === line &&
        o.direction === direction &&
        timeBand(o.capturedAt) === band,
    )
    .map(readingHeadway)
    .filter((h): h is number => h != null);
  if (headways.length >= 2)
    return { headway: median(headways)!, source: "observed", count: headways.length, band };
  return { headway: BANDS[band].fallback, source: "fallback", count: headways.length, band };
}
