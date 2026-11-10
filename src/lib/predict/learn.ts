/**
 * Predictor v2 learning: per platform/direction, per day type (weekday /
 * Saturday / Sunday & public holiday) and 30-minute time band, from every
 * known train (error ≤ 1 min) on earlier days:
 *  - the usual gap between trains (median, multiples of it folded back), and
 *  - whether clock times repeat day to day, by scoring real predictions:
 *    for each day, the previous matching day's clock times (stepped by the
 *    usual gap) "predict" that day's trains; the day is a hit when every
 *    train came within ±1 min. The band repeats only with ≥ 4 hits in the
 *    last 5 scored days AND a usual gap ≥ 4 min (at shorter gaps any time
 *    is within a minute of some train). Fewer than 5 scored days → unknown
 *    (v1 rules, incl. the weekday 09:15–10:30 window).
 * v2.0 compared the phase spread across ≥ 3 days instead, which marked
 * random phases as repeating (≈ 48 % of the time at 2.5-min gaps).
 */
import { MINUTE, median, sgtDate, sgtMidnight, sgtMinuteOfDay, sgtWeekday } from "../time";
import type { KnownTrain } from "./sightings";

/**
 * Singapore public holidays — Ministry of Manpower list
 * (mom.gov.sg/employment-practices/public-holidays, checked 2026-11-10).
 * A Sunday holiday's Monday in lieu is included. A date counts as Sunday /
 * public holiday ONLY when listed here; unlisted dates (e.g. 2028 until
 * added) fall back to their weekday. Extend yearly.
 */
export const PUBLIC_HOLIDAYS = new Set<string>([
  // 2025
  "2025-01-01", "2025-01-29", "2025-01-30", "2025-03-31", "2025-04-18", "2025-05-01", "2025-05-03", "2025-05-12",
  "2025-06-07", "2025-08-09", "2025-10-20", "2025-12-25",
  // 2026: New Year, CNY ×2, Hari Raya Puasa, Good Friday, Labour Day, Hari Raya Haji,
  // Vesak (Sun 31 May → Mon 1 Jun), National Day (Sun → Mon 10 Aug), Deepavali (Sun → Mon 9 Nov), Christmas
  "2026-01-01", "2026-02-17", "2026-02-18", "2026-03-21", "2026-04-03", "2026-05-01", "2026-05-27", "2026-05-31",
  "2026-06-01", "2026-08-09", "2026-08-10", "2026-11-08", "2026-11-09", "2026-12-25",
  // 2027: New Year, CNY Sat 6 + Sun 7 Feb (→ Mon 8 Feb), Hari Raya Puasa, Good Friday, Labour Day,
  // Hari Raya Haji, Vesak, National Day, Deepavali, Christmas
  "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-03-10", "2027-03-26", "2027-05-01", "2027-05-17",
  "2027-05-20", "2027-08-09", "2027-10-28", "2027-12-25",
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
  /** Days whose trains were scored against the previous matching day's clock times. */
  scoredDays: number;
  /** Of the last 5 scored days, how many the previous day predicted (every train ±1 min). */
  hits: number;
  stability: Stability;
  /** Position of the most recent day's trains within the gap, minutes after the band start. */
  phaseMin: number | null;
};

/** Trains with more error than this don't teach anything about clock times. */
export const LEARN_MAX_ERR_MIN = 1;
export const SCORED_DAYS_NEEDED = 5;
export const HITS_NEEDED = 4;
/** Below this gap, ±1 min matches by chance too often to call it repeating. */
export const MIN_REPEAT_GAP_MIN = 4;
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

/** Did `previous` day's clock times (on a grid of the gap) predict every train of `day` within ±1 min? */
export function dayPredicted(previous: number[], day: number[], headway: number): boolean {
  if (!previous.length || !day.length) return false;
  return day.every((tod) => previous.some((p) => circularDistance(tod, p, headway) <= REPEAT_TOLERANCE_MIN));
}

/**
 * Learn one band from known trains at a platform (any days). Only trains
 * with error ≤ 1 min on days before `now`'s day, of the same day type,
 * inside the band containing `now`, are used.
 */
export function learnBand(trains: Pick<KnownTrain, "at" | "errMin">[], now: number, fallbackHeadway?: number): BandStats {
  const type = dayType3(now);
  const start = bandStartMinute(now);
  const today = sgtDate(now);
  const byDay = new Map<string, number[]>();
  for (const t of trains) {
    if (t.errMin > LEARN_MAX_ERR_MIN) continue;
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
  const base: BandStats = { key: band30Key(now), headway: learned, gaps: folded.length, days: days.length, scoredDays: 0, hits: 0, stability: "unknown", phaseMin: null };
  if (!headway || days.length < 2) return base;

  // Score each day against the previous matching day (on the gap's circle).
  const phases = (day: string) => byDay.get(day)!.map((tod) => mod(tod - start, headway));
  const scores: boolean[] = [];
  for (let i = 1; i < days.length; i++) scores.push(dayPredicted(phases(days[i - 1]), phases(days[i]), headway));
  const last = scores.slice(-SCORED_DAYS_NEEDED);
  const hits = last.filter(Boolean).length;
  const latest = days[days.length - 1];
  const stats = { ...base, scoredDays: scores.length, hits, phaseMin: circularMean(phases(latest), headway) };
  if (scores.length < SCORED_DAYS_NEEDED) return stats;
  return { ...stats, stability: hits >= HITS_NEEDED && headway >= MIN_REPEAT_GAP_MIN ? "repeats" : "drifts" };
}

/** Next trains from a repeating band: the most recent day's clock times on a grid of the learned gap. */
export function repeatArrivals(stats: BandStats, now: number, count = 3): number[] {
  if (stats.stability !== "repeats" || stats.headway == null || stats.phaseMin == null) return [];
  const h = stats.headway * MINUTE;
  const origin = sgtMidnight(now) + (bandStartMinute(now) + stats.phaseMin) * MINUTE;
  const k = Math.ceil((now - 15_000 - origin) / h);
  return Array.from({ length: count }, (_, i) => origin + (k + i) * h);
}
