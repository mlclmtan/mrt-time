/**
 * Predictor v2 learning: per platform/direction, per day type (weekday /
 * Saturday / Sunday & public holiday) and 30-minute time band, from every
 * known train across days:
 *  - the usual gap between trains (median, multiples of it folded back), and
 *  - whether clock times repeat day to day: the phase of the trains within
 *    the gap is compared with the previous day that has data; if it moves by
 *    ≤ 1 min across ≥ 3 days the band "repeats" (another day's clock times
 *    can be projected), otherwise it "drifts" (show ranges).
 */
import { MINUTE, median, sgtDate, sgtMidnight, sgtMinuteOfDay, sgtWeekday } from "../time";
import type { KnownTrain } from "./sightings";

/** Singapore public holidays (MOM gazette; Sunday holidays move to Monday). Data, extend yearly. */
export const PUBLIC_HOLIDAYS = new Set<string>([
  // 2025
  "2025-01-01", "2025-01-29", "2025-01-30", "2025-03-31", "2025-04-18", "2025-05-01", "2025-05-03", "2025-05-12",
  "2025-06-07", "2025-08-09", "2025-10-20", "2025-12-25",
  // 2026
  "2026-01-01", "2026-02-17", "2026-02-18", "2026-03-21", "2026-04-03", "2026-05-01", "2026-05-27", "2026-05-31",
  "2026-06-01", "2026-08-09", "2026-08-10", "2026-11-08", "2026-11-09", "2026-12-25",
]);

export type DayType3 = "weekday" | "saturday" | "sunday_ph";
export function dayType3(instant: number): DayType3 {
  if (PUBLIC_HOLIDAYS.has(sgtDate(instant))) return "sunday_ph";
  const wd = sgtWeekday(instant);
  return wd === 7 ? "sunday_ph" : wd === 6 ? "saturday" : "weekday";
}

export const BAND_MIN = 30;
/** Start of the 30-min band (minute of day) containing an instant. */
export function bandStartMinute(instant: number): number {
  return Math.floor(sgtMinuteOfDay(instant) / BAND_MIN) * BAND_MIN;
}
/** "weekday_09:30" style key. */
export function band30Key(instant: number): string {
  const m = bandStartMinute(instant);
  return `${dayType3(instant)}_${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export type Stability = "repeats" | "drifts" | "unknown";
export type BandStats = {
  key: string;
  /** Usual gap between trains, minutes (null when < 2 gaps seen). */
  headway: number | null;
  gaps: number;
  /** Days (before today) with trains in this band. */
  days: number;
  stability: Stability;
  /** Largest day-to-day move of the clock times, minutes. */
  phaseSpreadMin: number | null;
  /** Typical position of trains within the gap, minutes after the band start. */
  phaseMin: number | null;
};

/** Days needed before deciding whether times repeat. */
export const MIN_DAYS = 3;
export const REPEAT_TOLERANCE_MIN = 1;
const MAX_GAP_MIN = 20;

const mod = (x: number, m: number) => ((x % m) + m) % m;
/** Circular mean of values on a circle of length `period`. */
function circularMean(values: number[], period: number): number {
  let s = 0;
  let c = 0;
  for (const v of values) {
    const a = (2 * Math.PI * v) / period;
    s += Math.sin(a);
    c += Math.cos(a);
  }
  return mod((Math.atan2(s, c) * period) / (2 * Math.PI), period);
}
function circularDistance(a: number, b: number, period: number) {
  const d = mod(a - b, period);
  return Math.min(d, period - d);
}

/** Fold gaps that span several trains (e.g. 10 min with trains every 5) back to one gap. */
export function foldGaps(gaps: number[]): number[] {
  const base = median(gaps);
  if (!base) return gaps;
  return gaps.map((g) => {
    const k = Math.round(g / base);
    return k >= 2 ? g / k : g;
  });
}

/**
 * Learn one band from known trains at a platform (any days). Only trains
 * with ≤ 1 min spread on days before `now`'s day, of the same day type,
 * inside the band containing `now`, are used.
 */
export function learnBand(trains: Pick<KnownTrain, "at" | "spreadMin">[], now: number, fallbackHeadway?: number): BandStats {
  const type = dayType3(now);
  const start = bandStartMinute(now);
  const today = sgtDate(now);
  const byDay = new Map<string, number[]>();
  for (const t of trains) {
    if (t.spreadMin > 1) continue;
    const day = sgtDate(t.at);
    if (day >= today || dayType3(t.at) !== type) continue;
    const tod = sgtMinuteOfDay(t.at);
    if (tod < start || tod >= start + BAND_MIN) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), tod]);
  }
  const days = [...byDay.keys()].sort();
  const gaps: number[] = [];
  for (const day of days) {
    const tods = [...new Set(byDay.get(day)!.map((x) => Math.round(x * 4) / 4))].sort((a, b) => a - b);
    for (let i = 1; i < tods.length; i++) {
      const g = tods[i] - tods[i - 1];
      if (g >= 0.75 && g <= MAX_GAP_MIN) gaps.push(g);
    }
  }
  const folded = foldGaps(gaps);
  const learned = folded.length >= 2 ? median(folded) : null;
  const headway = learned ?? fallbackHeadway ?? null;
  const key = band30Key(now);
  const base: BandStats = { key, headway: learned, gaps: folded.length, days: days.length, stability: "unknown", phaseSpreadMin: null, phaseMin: null };
  if (!headway || days.length < MIN_DAYS) return base;

  const phases = days.map((day) => circularMean(byDay.get(day)!.map((tod) => mod(tod - start, headway)), headway));
  let spread = 0;
  for (let i = 1; i < phases.length; i++) spread = Math.max(spread, circularDistance(phases[i], phases[i - 1], headway));
  return {
    ...base,
    stability: spread <= REPEAT_TOLERANCE_MIN ? "repeats" : "drifts",
    phaseSpreadMin: Math.round(spread * 10) / 10,
    phaseMin: circularMean(phases, headway),
  };
}

/** Next trains from a repeating band: the learned phase on a grid of the learned gap. */
export function repeatArrivals(stats: BandStats, now: number, count = 3): number[] {
  if (stats.stability !== "repeats" || stats.headway == null || stats.phaseMin == null) return [];
  const h = stats.headway * MINUTE;
  const origin = sgtMidnight(now) + (bandStartMinute(now) + stats.phaseMin) * MINUTE;
  const k = Math.ceil((now - 15_000 - origin) / h);
  return Array.from({ length: count }, (_, i) => origin + (k + i) * h);
}
