/** Commute stats from the owner's own taps. Pure: no DB, no clock reads. */
import { stationForCode, getPlatform } from "../network";
import { clockFromMinutes, median, sgtDate, sgtMinuteOfDay, sgtWeekday, DAY, HOUR, MINUTE } from "../time";

export type StatEvent = {
  kind: string;
  /** Unix ms of the tap. */
  at: number;
  station?: string | null;
  line?: string | null;
  direction?: string | null;
  journeyKey?: string | null;
};

export type TripDirection = "to_work" | "to_home";

export type Trip = {
  /** SGT "YYYY-MM-DD" of the leaving tap. */
  date: string;
  /** 1 = Monday … 7 = Sunday (SGT). */
  weekday: number;
  leaveAt: number;
  arriveAt: number;
  minutes: number;
  direction: TripDirection;
};

/** count / median / min / max of a list of minutes. */
export type Spread = { count: number; median: number; min: number; max: number };

export type PlatformWait = Spread & { station: string; line: string | null; direction: string | null };
export type ChangeTime = Spread & { stationSlug: string; from: string; to: string; key: string; outram: boolean };
export type RideTime = Spread & { from: string; to: string; key: string; line: string | null };

export type WeekStat = {
  /** Monday of the ISO week, SGT "YYYY-MM-DD". */
  weekStart: string;
  toWork: number | null;
  toHome: number | null;
  toWorkTrips: number;
  toHomeTrips: number;
};
export type WeekdayStat = Omit<WeekStat, "weekStart"> & { weekday: number };

export type LeaveSlot = Spread & { slot: string; enough: boolean };
export type BestLeave = { best: LeaveSlot; slots: LeaveSlot[] };

export type CommuteStats = {
  trips: Trip[];
  typical: { toWork: number | null; toHome: number | null };
  waits: PlatformWait[];
  changes: ChangeTime[];
  rides: RideTime[];
  weekly: WeekStat[];
  byWeekday: WeekdayStat[];
  bestLeave: BestLeave | null;
};

export const MAX_TRIP_MS = 3 * HOUR;
export const MAX_WAIT_MS = 30 * MINUTE;
export const MAX_CHANGE_MS = 20 * MINUTE;
export const MAX_RIDE_MS = 90 * MINUTE;
export const MIN_SLOT_TRIPS = 3;
export const OUTRAM_CHANGES = ["EW16→TE17", "TE17→EW16"] as const;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function minutesBetween(a: number, b: number): number {
  return round1((b - a) / MINUTE);
}
function med(values: number[]): number | null {
  const m = median(values);
  return m == null ? null : round1(m);
}
export function spread(values: number[]): Spread {
  return { count: values.length, median: med(values) ?? 0, min: Math.min(...values), max: Math.max(...values) };
}
function sorted(events: readonly StatEvent[]): StatEvent[] {
  return events.filter((e) => Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
}
function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Door → desk and desk → door trips; both ends must be logged on the same SGT day. */
export function findTrips(events: readonly StatEvent[]): Trip[] {
  const ends = sorted(events).filter((e) => e.kind === "door" || e.kind === "desk");
  const trips: Trip[] = [];
  for (let i = 0; i + 1 < ends.length; i++) {
    const a = ends[i];
    const b = ends[i + 1];
    if (a.kind === b.kind) continue;
    if (sgtDate(a.at) !== sgtDate(b.at)) continue;
    if (b.at <= a.at || b.at - a.at > MAX_TRIP_MS) continue;
    trips.push({
      date: sgtDate(a.at),
      weekday: sgtWeekday(a.at),
      leaveAt: a.at,
      arriveAt: b.at,
      minutes: minutesBetween(a.at, b.at),
      direction: a.kind === "door" ? "to_work" : "to_home",
    });
  }
  return trips;
}

/** Waiting on the platform: "on the platform" tap → next "boarded" tap at the same platform. */
export function platformWaits(events: readonly StatEvent[]): PlatformWait[] {
  const rows: { station: string; line: string | null; direction: string | null; minutes: number }[] = [];
  let waiting: StatEvent | null = null;
  for (const e of sorted(events)) {
    if (e.kind === "at_platform") {
      waiting = e.station ? e : null;
    } else if (e.kind === "board") {
      if (waiting && e.station && e.station === waiting.station && e.at - waiting.at <= MAX_WAIT_MS) {
        rows.push({
          station: e.station,
          line: e.line ?? waiting.line ?? getPlatform(e.station)?.line ?? null,
          direction: e.direction ?? waiting.direction ?? null,
          minutes: minutesBetween(waiting.at, e.at),
        });
      }
      waiting = null;
    }
  }
  return [...groupBy(rows, (r) => `${r.station}|${r.direction ?? ""}`).values()]
    .map((list) => ({ station: list[0].station, line: list[0].line, direction: list[0].direction, ...spread(list.map((r) => r.minutes)) }))
    .sort((a, b) => b.count - a.count || a.station.localeCompare(b.station) || (a.direction ?? "").localeCompare(b.direction ?? ""));
}

/** Changing trains: "got off" at platform A → next "boarded" at another platform of the same station. */
export function changeTimes(events: readonly StatEvent[]): ChangeTime[] {
  const rows: { stationSlug: string; from: string; to: string; minutes: number }[] = [];
  let off: StatEvent | null = null;
  for (const e of sorted(events)) {
    if (e.kind === "alight") {
      off = e.station ? e : null;
    } else if (e.kind === "board") {
      if (off?.station && e.station && e.station !== off.station && e.at - off.at <= MAX_CHANGE_MS) {
        const a = stationForCode(off.station)?.slug;
        const b = stationForCode(e.station)?.slug;
        if (a && a === b) rows.push({ stationSlug: a, from: off.station, to: e.station, minutes: minutesBetween(off.at, e.at) });
      }
      off = null;
    } else if (e.kind === "door" || e.kind === "desk" || e.kind === "tap_out") {
      off = null;
    }
  }
  return [...groupBy(rows, (r) => `${r.from}→${r.to}`).entries()]
    .map(([key, list]) => ({
      stationSlug: list[0].stationSlug,
      from: list[0].from,
      to: list[0].to,
      key,
      outram: (OUTRAM_CHANGES as readonly string[]).includes(key),
      ...spread(list.map((r) => r.minutes)),
    }))
    .sort((a, b) => Number(b.outram) - Number(a.outram) || b.count - a.count || a.key.localeCompare(b.key));
}

/** Time on the train: "boarded" at A → next "got off" at B. */
export function rideTimes(events: readonly StatEvent[]): RideTime[] {
  const rows: { from: string; to: string; line: string | null; minutes: number }[] = [];
  let on: StatEvent | null = null;
  for (const e of sorted(events)) {
    if (e.kind === "board") {
      on = e.station ? e : null;
    } else if (e.kind === "alight") {
      if (on?.station && e.station && e.station !== on.station && e.at - on.at <= MAX_RIDE_MS) {
        rows.push({ from: on.station, to: e.station, line: on.line ?? getPlatform(on.station)?.line ?? null, minutes: minutesBetween(on.at, e.at) });
      }
      on = null;
    }
  }
  return [...groupBy(rows, (r) => `${r.from}→${r.to}`).entries()]
    .map(([key, list]) => ({ from: list[0].from, to: list[0].to, key, line: list[0].line, ...spread(list.map((r) => r.minutes)) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Monday ("YYYY-MM-DD") of the ISO week containing an SGT date. */
export function weekStart(date: string): string {
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  const offset = (new Date(midnight).getUTCDay() + 6) % 7;
  return new Date(midnight - offset * DAY).toISOString().slice(0, 10);
}

function directionMedians(trips: readonly Trip[]) {
  const toWork = trips.filter((t) => t.direction === "to_work").map((t) => t.minutes);
  const toHome = trips.filter((t) => t.direction === "to_home").map((t) => t.minutes);
  return { toWork: med(toWork), toHome: med(toHome), toWorkTrips: toWork.length, toHomeTrips: toHome.length };
}

/** Median door → desk and desk → door per ISO week (oldest first). */
export function weeklyTrend(trips: readonly Trip[]): WeekStat[] {
  return [...groupBy(trips, (t) => weekStart(t.date)).entries()]
    .map(([start, list]) => ({ weekStart: start, ...directionMedians(list) }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Median door → desk and desk → door for Monday … Sunday (always 7 rows). */
export function byWeekday(trips: readonly Trip[]): WeekdayStat[] {
  return Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, ...directionMedians(trips.filter((t) => t.weekday === i + 1)) }));
}

/** "08:10" for a leave tap at 08:10–08:19 SGT. */
export function leaveSlot(at: number): string {
  return clockFromMinutes(Math.floor(sgtMinuteOfDay(at) / 10) * 10);
}

/** Door → desk trips grouped by 10-minute leave slot; best = lowest median among slots with ≥ 3 trips. */
export function bestTimeToLeave(trips: readonly Trip[]): BestLeave | null {
  const slots = [...groupBy(trips.filter((t) => t.direction === "to_work"), (t) => leaveSlot(t.leaveAt)).entries()]
    .map(([slot, list]) => ({ slot, enough: list.length >= MIN_SLOT_TRIPS, ...spread(list.map((t) => t.minutes)) }))
    .sort((a, b) => a.slot.localeCompare(b.slot));
  const ranked = slots.filter((s) => s.enough).sort((a, b) => a.median - b.median || b.count - a.count || a.slot.localeCompare(b.slot));
  return ranked.length ? { best: ranked[0], slots } : null;
}

export function commuteStats(events: readonly StatEvent[]): CommuteStats {
  const trips = findTrips(events);
  const all = directionMedians(trips);
  return {
    trips,
    typical: { toWork: all.toWork, toHome: all.toHome },
    waits: platformWaits(events),
    changes: changeTimes(events),
    rides: rideTimes(events),
    weekly: weeklyTrend(trips),
    byWeekday: byWeekday(trips),
    bestLeave: bestTimeToLeave(trips),
  };
}
