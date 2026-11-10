import { describe, expect, it } from "vitest";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import { PUBLIC_HOLIDAYS, band30Key, dayPredicted, dayType3, foldGaps, learnBand, repeatArrivals } from "./learn";
import { predict } from "./index";
import type { TrainSighting } from "./sightings";

// Synthetic multi-day data only. 2026-11-02 … 11-06 are Mon–Fri; 11-07 Sat; 11-08 Sun; 11-09 a holiday Monday.
const WEEKDAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"];
const at = (date: string, clock: string) => sgtInstant(date, clock);

/** Trains every 5 min in the 09:30 band; `shift(day)` moves that day's times. */
function band(shift: (i: number) => number, days = WEEKDAYS) {
  return days.flatMap((d, i) => [0, 5, 10, 15, 20].map((m) => ({ at: at(d, "09:32") + (m + shift(i)) * MINUTE, errMin: 0.5 })));
}
const sighting = (date: string, clock: string, offsetMin = 0): TrainSighting => ({
  station: "EW17",
  line: "EWL",
  direction: "TO_EAST",
  at: at(date, clock) + offsetMin * MINUTE,
  kind: "boarded",
  source: "owner",
  status: "approved",
});

describe("day types and bands", () => {
  it("weekday / Saturday / Sunday & public holiday, 30-min bands", () => {
    expect(dayType3(at("2026-11-03", "09:00"))).toBe("weekday");
    expect(dayType3(at("2026-11-07", "09:00"))).toBe("saturday");
    expect(dayType3(at("2026-11-08", "09:00"))).toBe("sunday_ph");
    expect(dayType3(at("2026-11-09", "09:00"))).toBe("sunday_ph"); // Deepavali (observed)
    // 2027 (MOM list): CNY Sunday 7 Feb → Monday 8 Feb in lieu; Vesak Thursday 20 May.
    expect(dayType3(at("2027-02-08", "09:00"))).toBe("sunday_ph");
    expect(dayType3(at("2027-05-20", "09:00"))).toBe("sunday_ph");
    expect(dayType3(at("2027-05-21", "09:00"))).toBe("weekday");
    // Only listed dates are holidays: an ordinary 2028 weekday stays a weekday.
    expect(dayType3(at("2028-03-07", "09:00"))).toBe("weekday");
    expect([...PUBLIC_HOLIDAYS].filter((d) => d.startsWith("2027"))).toHaveLength(12);
    expect(band30Key(at("2026-11-03", "09:44"))).toBe("weekday_09:30");
  });
  it("folds gaps that skip a train", () => {
    expect(foldGaps([5, 5, 10, 5, 15])).toEqual([5, 5, 5, 5, 5]);
  });
});

describe("learning per platform band", () => {
  const now = at("2026-11-05", "09:40"); // Thursday

  it("a band whose clock times repeat (±0.5 min) is marked 'repeats' and projects them", () => {
    const stats = learnBand(band((i) => (i % 2 ? 0.5 : 0)), now);
    // 8 days → 7 scored against the day before; all of the last 5 predicted within ±1 min.
    expect(stats).toMatchObject({ stability: "repeats", headway: 5, days: 8, scoredDays: 7, hits: 5 });
    const next = repeatArrivals(stats, now);
    expect(next.map(sgtClock)).toEqual(["09:42", "09:47", "09:52"]);
  });

  it("a band whose times drift day to day is marked 'drifts'", () => {
    const stats = learnBand(band((i) => (i * 1.7) % 5), now);
    expect(stats.stability).toBe("drifts");
    expect(stats.headway).toBe(5);
    expect(repeatArrivals(stats, now)).toEqual([]);
  });

  it("needs 5 scored days (6 days of data) of the same day type; today and other day types don't count", () => {
    expect(learnBand(band(() => 0, WEEKDAYS.slice(0, 2)), now).stability).toBe("unknown");
    // 5 days = 4 scored: still v1 rules, even though they repeat perfectly.
    expect(learnBand(band(() => 0, WEEKDAYS.slice(0, 5)), now)).toMatchObject({ stability: "unknown", scoredDays: 4 });
    expect(learnBand(band(() => 0, WEEKDAYS.slice(0, 6)), now)).toMatchObject({ stability: "repeats", scoredDays: 5 });
    const saturday = learnBand(band(() => 0), at("2026-11-07", "09:40"));
    expect(saturday.days).toBe(0);
    const withToday = learnBand(band(() => 0, ["2026-11-05"]), now);
    expect(withToday.days).toBe(0);
  });

  it("predictions: repeating band → clock times from other days; drifting band → a range, even outside the admin windows", () => {
    const repeating: TrainSighting[] = WEEKDAYS.flatMap((d) => [0, 5, 10, 15, 20].map((m) => sighting(d, "09:32", m)));
    const p = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now, observations: [], sightings: repeating });
    // 09:40 is inside the default weekday 09:15–10:30 unstable window, but learning says it repeats.
    expect(p.basis).toBe("historical");
    expect(p.reason).toEqual({ code: "repeats", params: { days: 8 } });
    expect(sgtClock(p.arrivals[0].at)).toBe("09:42");
    expect(p.stability).toBe("repeats");
    // An admin-edited window still wins.
    const forced = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now, observations: [], sightings: repeating, windowsCustom: true });
    expect(forced.kind).toBe("range");

    const drifting: TrainSighting[] = WEEKDAYS.flatMap((d, i) => [0, 5, 10, 15].map((m) => sighting(d, "13:02", m + ((i * 1.7) % 5))));
    const later = at("2026-11-05", "13:10");
    const q = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now: later, observations: [], sightings: drifting, unstableWindows: [] });
    expect(q.kind).toBe("range");
    expect(q.unstable).toBe(true);
    expect(q.reason.code).toBe("unstable_window");
    expect(q.headwayMin).toBe(5);
  });
});

describe("repeat test: scored predictions, not phase spread (F5)", () => {
  const now = at("2026-11-05", "09:40");
  /** Deterministic PRNG (mulberry32). */
  const rng = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** `days` weekdays, `perDay` real trains each at a random position on a grid of `gap` minutes. */
  const randomBand = (seed: number, gap: number, perDay: number) => {
    const r = rng(seed);
    return WEEKDAYS.flatMap((d) => {
      const phase = r() * gap;
      return Array.from({ length: perDay }, (_, k) => ({ at: at(d, "09:30") + (phase + k * gap) * MINUTE, errMin: 0.5 }));
    }).filter((t) => (t.at - at(new Date(t.at).toISOString().slice(0, 10), "09:30")) / MINUTE < 30);
  };

  it("random phases at a 2.5-min gap are never marked repeating (v2.0 did ~48 % of the time)", () => {
    for (let seed = 1; seed <= 200; seed++) expect(learnBand(randomBand(seed, 2.5, 6), now).stability).not.toBe("repeats");
  });

  it("random phases at a 6-min gap are rarely marked repeating (< 5 % of 300 bands)", () => {
    let repeats = 0;
    for (let seed = 1; seed <= 300; seed++) if (learnBand(randomBand(seed, 6, 3), now).stability === "repeats") repeats++;
    expect(repeats / 300).toBeLessThan(0.05);
  });

  it("a day counts as predicted only when every train was within ±1 min of the previous day's grid", () => {
    expect(dayPredicted([0.5], [0.7, 5.4], 5)).toBe(true);
    expect(dayPredicted([0.5], [0.7, 2.9], 5)).toBe(false);
    expect(dayPredicted([], [1], 5)).toBe(false);
  });

  it("a short gap (< 4 min) never repeats, even when times line up", () => {
    const tight = WEEKDAYS.flatMap((d) => [0, 3, 6, 9, 12].map((m) => ({ at: at(d, "09:31") + m * MINUTE, errMin: 0.5 })));
    expect(learnBand(tight, now)).toMatchObject({ headway: 3, stability: "drifts" });
  });

  it("until a band has 5 scored days the v1 rules (incl. the weekday 09:15–10:30 window) apply", () => {
    const four: TrainSighting[] = WEEKDAYS.slice(0, 5).flatMap((d) => [0, 5, 10, 15, 20].map((m) => sighting(d, "09:32", m)));
    const p = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now, observations: [], sightings: four });
    expect(p.stability).toBe("unknown");
    expect(p.kind).toBe("range");
    expect(p.reason.code).toBe("unstable_window");
  });
});
