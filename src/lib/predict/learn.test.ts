import { describe, expect, it } from "vitest";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import { band30Key, dayType3, foldGaps, learnBand, repeatArrivals } from "./learn";
import { predict } from "./index";
import type { TrainSighting } from "./sightings";

// Synthetic multi-day data only. 2026-11-02 … 11-06 are Mon–Fri; 11-07 Sat; 11-08 Sun; 11-09 a holiday Monday.
const WEEKDAYS = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"];
const at = (date: string, clock: string) => sgtInstant(date, clock);

/** Trains every 5 min in the 09:30 band; `shift(day)` moves that day's times. */
function band(shift: (i: number) => number, days = WEEKDAYS) {
  return days.flatMap((d, i) => [0, 5, 10, 15, 20].map((m) => ({ at: at(d, "09:32") + (m + shift(i)) * MINUTE, spreadMin: 0 })));
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
    expect(stats).toMatchObject({ stability: "repeats", headway: 5, days: 8 });
    expect(stats.phaseSpreadMin).toBeLessThanOrEqual(1);
    const next = repeatArrivals(stats, now);
    expect(next.map(sgtClock)).toEqual(["09:42", "09:47", "09:52"]);
  });

  it("a band whose times drift day to day is marked 'drifts'", () => {
    const stats = learnBand(band((i) => (i * 1.7) % 5), now);
    expect(stats.stability).toBe("drifts");
    expect(stats.headway).toBe(5);
    expect(repeatArrivals(stats, now)).toEqual([]);
  });

  it("needs ≥ 3 earlier days of the same day type; today and other day types don't count", () => {
    expect(learnBand(band(() => 0, WEEKDAYS.slice(0, 2)), now).stability).toBe("unknown");
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
