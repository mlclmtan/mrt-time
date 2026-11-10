import { describe, expect, it } from "vitest";
import { sgtInstant } from "../time";
import {
  bestTimeToLeave,
  byWeekday,
  changeTimes,
  commuteStats,
  findTrips,
  leaveSlot,
  platformWaits,
  rideTimes,
  weekStart,
  weeklyTrend,
  type StatEvent,
} from "./commute";

// Synthetic data only. 2026-11-02 is a Monday.
const ev = (date: string, clock: string, kind: string, extra: Partial<StatEvent> = {}): StatEvent => ({ kind, at: sgtInstant(date, clock), ...extra });

/** A full door → desk day: leave at `leave`, arrive `mins` minutes later. */
function toWork(date: string, leave: string, mins: number): StatEvent[] {
  const at = sgtInstant(date, leave);
  return [
    { kind: "door", at },
    { kind: "desk", at: at + mins * 60_000 },
  ];
}

describe("findTrips", () => {
  it("pairs door → desk and desk → door on the same day", () => {
    const trips = findTrips([
      ev("2026-11-02", "08:05", "door"),
      ev("2026-11-02", "08:20", "tap_in", { station: "EW17" }),
      ev("2026-11-02", "08:52", "desk"),
      ev("2026-11-02", "18:30", "desk"),
      ev("2026-11-02", "19:15", "door"),
    ]);
    expect(trips).toHaveLength(2);
    expect(trips[0]).toMatchObject({ direction: "to_work", minutes: 47, date: "2026-11-02", weekday: 1 });
    expect(trips[1]).toMatchObject({ direction: "to_home", minutes: 45 });
  });

  it("needs both ends: a missing desk or door is never invented", () => {
    expect(findTrips([ev("2026-11-03", "08:00", "door"), ev("2026-11-03", "08:30", "board", { station: "EW17" })])).toEqual([]);
    expect(findTrips([ev("2026-11-03", "18:00", "desk")])).toEqual([]);
  });

  it("ignores pairs more than 3 hours apart or across days", () => {
    expect(findTrips([ev("2026-11-03", "06:00", "door"), ev("2026-11-03", "09:30", "desk")])).toEqual([]);
    expect(findTrips([ev("2026-11-03", "23:30", "desk"), ev("2026-11-04", "00:20", "door")])).toEqual([]);
  });

  it("uses the last door tap when it is tapped twice", () => {
    const trips = findTrips([ev("2026-11-04", "07:50", "door"), ev("2026-11-04", "08:00", "door"), ev("2026-11-04", "08:40", "desk")]);
    expect(trips).toHaveLength(1);
    expect(trips[0].minutes).toBe(40);
  });

  it("is order independent and rounds to 1 decimal", () => {
    const at = sgtInstant("2026-11-05", "08:00");
    const trips = findTrips([
      { kind: "desk", at: at + 45 * 60_000 + 20_000 },
      { kind: "door", at },
    ]);
    expect(trips[0].minutes).toBe(45.3);
  });
});

describe("platformWaits", () => {
  it("groups by platform and direction", () => {
    const waits = platformWaits([
      ev("2026-11-02", "08:20", "at_platform", { station: "EW17", line: "EWL", direction: "TO_EAST" }),
      ev("2026-11-02", "08:23", "board", { station: "EW17", line: "EWL", direction: "TO_EAST" }),
      ev("2026-11-03", "08:20", "at_platform", { station: "EW17", line: "EWL", direction: "TO_EAST" }),
      ev("2026-11-03", "08:21", "board", { station: "EW17", line: "EWL", direction: "TO_EAST" }),
      ev("2026-11-04", "08:20", "at_platform", { station: "EW17", line: "EWL", direction: "TO_EAST" }),
      ev("2026-11-04", "08:26", "board", { station: "EW17", line: "EWL", direction: "TO_EAST" }),
      ev("2026-11-04", "18:40", "at_platform", { station: "TE17" }),
      ev("2026-11-04", "18:42", "board", { station: "TE17" }),
    ]);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toMatchObject({ station: "EW17", direction: "TO_EAST", count: 3, median: 3, min: 1, max: 6 });
    expect(waits[1]).toMatchObject({ station: "TE17", direction: null, line: "TEL", count: 1, median: 2 });
  });

  it("skips boards at another platform or more than 30 minutes later", () => {
    expect(
      platformWaits([
        ev("2026-11-02", "08:20", "at_platform", { station: "EW17" }),
        ev("2026-11-02", "08:23", "board", { station: "EW16" }),
        ev("2026-11-03", "08:00", "at_platform", { station: "EW17" }),
        ev("2026-11-03", "08:31", "board", { station: "EW17" }),
      ]),
    ).toEqual([]);
  });
});

describe("changeTimes", () => {
  it("measures got off → boarded at the same station, Outram Park first, zero kept", () => {
    const changes = changeTimes([
      // Another interchange, logged more often.
      ev("2026-11-02", "08:00", "alight", { station: "NE3" }),
      ev("2026-11-02", "08:04", "board", { station: "EW16" }),
      ev("2026-11-03", "08:00", "alight", { station: "NE3" }),
      ev("2026-11-03", "08:05", "board", { station: "EW16" }),
      // Outram Park EW → TE: once with a sprint (0 min), once 4 min via the platform.
      ev("2026-11-04", "08:30", "alight", { station: "EW16" }),
      ev("2026-11-04", "08:30", "board", { station: "TE17" }),
      ev("2026-11-05", "08:30", "alight", { station: "EW16" }),
      ev("2026-11-05", "08:32", "at_platform", { station: "TE17" }),
      ev("2026-11-05", "08:34", "board", { station: "TE17" }),
    ]);
    expect(changes.map((c) => c.key)).toEqual(["EW16→TE17", "NE3→EW16"]);
    expect(changes[0]).toMatchObject({ stationSlug: "outram-park", outram: true, count: 2, min: 0, max: 4, median: 2 });
  });

  it("ignores boards at a different station or after 20 minutes", () => {
    expect(
      changeTimes([
        ev("2026-11-02", "08:00", "alight", { station: "EW16" }),
        ev("2026-11-02", "08:03", "board", { station: "EW17" }),
        ev("2026-11-03", "08:00", "alight", { station: "EW16" }),
        ev("2026-11-03", "08:21", "board", { station: "TE17" }),
      ]),
    ).toEqual([]);
  });
});

describe("rideTimes", () => {
  it("groups boarded → got off by from → to", () => {
    const rides = rideTimes([
      ev("2026-11-02", "08:23", "board", { station: "EW17", line: "EWL" }),
      ev("2026-11-02", "08:27", "alight", { station: "EW16" }),
      ev("2026-11-03", "08:23", "board", { station: "EW17", line: "EWL" }),
      ev("2026-11-03", "08:28", "alight", { station: "EW16" }),
      ev("2026-11-03", "08:30", "board", { station: "TE17" }),
      ev("2026-11-03", "08:35", "alight", { station: "TE19" }),
      ev("2026-11-04", "08:00", "board", { station: "EW17" }),
      ev("2026-11-04", "09:31", "alight", { station: "EW16" }),
    ]);
    expect(rides).toHaveLength(2);
    expect(rides[0]).toMatchObject({ key: "EW17→EW16", line: "EWL", count: 2, median: 4.5, min: 4, max: 5 });
    expect(rides[1]).toMatchObject({ key: "TE17→TE19", line: "TEL", count: 1 });
  });
});

describe("weekly and weekday", () => {
  it("weekStart is the Monday", () => {
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });

  it("groups across a week boundary, both directions", () => {
    const trips = findTrips([
      ...toWork("2026-11-06", "08:00", 40), // Fri, week 1
      ev("2026-11-06", "18:00", "desk"),
      ev("2026-11-06", "18:50", "door"),
      ...toWork("2026-11-08", "10:00", 30), // Sun, week 1
      ...toWork("2026-11-09", "08:00", 50), // Mon, week 2
      ...toWork("2026-11-10", "08:00", 44), // Tue, week 2
    ]);
    const weeks = weeklyTrend(trips);
    expect(weeks).toEqual([
      { weekStart: "2026-11-02", toWork: 35, toHome: 50, toWorkTrips: 2, toHomeTrips: 1 },
      { weekStart: "2026-11-09", toWork: 47, toHome: null, toWorkTrips: 2, toHomeTrips: 0 },
    ]);
    const days = byWeekday(trips);
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ weekday: 1, toWork: 50, toWorkTrips: 1 });
    expect(days[4]).toMatchObject({ weekday: 5, toWork: 40, toHome: 50 });
    expect(days[6]).toMatchObject({ weekday: 7, toWork: 30 });
    expect(days[2]).toMatchObject({ weekday: 3, toWork: null, toHome: null, toWorkTrips: 0 });
  });
});

describe("bestTimeToLeave", () => {
  it("leaveSlot floors to 10 minutes", () => {
    expect(leaveSlot(sgtInstant("2026-11-02", "08:10"))).toBe("08:10");
    expect(leaveSlot(sgtInstant("2026-11-02", "08:19"))).toBe("08:10");
    expect(leaveSlot(sgtInstant("2026-11-02", "08:20"))).toBe("08:20");
  });

  it("returns null when no slot has 3 trips", () => {
    const trips = findTrips([...toWork("2026-11-02", "08:10", 40), ...toWork("2026-11-03", "08:12", 41), ...toWork("2026-11-04", "08:20", 30)]);
    expect(bestTimeToLeave(trips)).toBeNull();
  });

  it("picks the lowest median among slots with at least 3 trips", () => {
    const trips = findTrips([
      ...toWork("2026-11-02", "08:10", 40),
      ...toWork("2026-11-03", "08:15", 42),
      ...toWork("2026-11-04", "08:19", 44),
      ...toWork("2026-11-05", "08:20", 35),
      ...toWork("2026-11-06", "08:22", 37),
      ...toWork("2026-11-09", "08:25", 36),
      // Only two trips: faster but not enough to count.
      ...toWork("2026-11-10", "07:50", 20),
      ...toWork("2026-11-11", "07:55", 20),
      // Desk → door never counts here.
      ev("2026-11-11", "18:00", "desk"),
      ev("2026-11-11", "18:10", "door"),
    ]);
    const result = bestTimeToLeave(trips);
    expect(result?.best).toMatchObject({ slot: "08:20", count: 3, median: 36, enough: true });
    expect(result?.slots.map((s) => [s.slot, s.count, s.enough])).toEqual([
      ["07:50", 2, false],
      ["08:10", 3, true],
      ["08:20", 3, true],
    ]);
  });
});

describe("commuteStats", () => {
  it("handles no events", () => {
    const s = commuteStats([]);
    expect(s.trips).toEqual([]);
    expect(s.typical).toEqual({ toWork: null, toHome: null });
    expect(s.bestLeave).toBeNull();
    expect(s.weekly).toEqual([]);
    expect(s.byWeekday).toHaveLength(7);
  });

  it("summarises a full day", () => {
    const s = commuteStats([
      ev("2026-11-02", "08:05", "door"),
      ev("2026-11-02", "08:18", "at_platform", { station: "EW17" }),
      ev("2026-11-02", "08:21", "board", { station: "EW17" }),
      ev("2026-11-02", "08:25", "alight", { station: "EW16" }),
      ev("2026-11-02", "08:27", "board", { station: "TE17" }),
      ev("2026-11-02", "08:31", "alight", { station: "TE19" }),
      ev("2026-11-02", "08:45", "desk"),
      ev("2026-11-02", "18:00", "desk"),
      ev("2026-11-02", "18:42", "door"),
    ]);
    expect(s.trips).toHaveLength(2);
    expect(s.typical).toEqual({ toWork: 40, toHome: 42 });
    expect(s.waits[0]).toMatchObject({ station: "EW17", median: 3 });
    expect(s.changes[0]).toMatchObject({ key: "EW16→TE17", median: 2 });
    expect(s.rides.map((r) => r.key)).toEqual(["EW17→EW16", "TE17→TE19"]);
  });
});
