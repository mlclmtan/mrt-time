import { describe, expect, it } from "vitest";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import type { Observation } from "../predict";
import type { Leg, TrainSource } from "./plan";
import { predictionSource } from "./source";
import {
  MANUAL_CHOICE_TTL_MS,
  autoJourneyKey,
  commuteProgress,
  commuteView,
  nextDepartures,
  parseJourneyChoice,
  serializeJourneyChoice,
} from "./commute";

// Synthetic fixtures only. 2026-11-03 is a Tuesday, 2026-11-02 a Monday.
const TUE = "2026-11-03";
const MON = "2026-11-02";
const at = (clock: string, date = TUE) => sgtInstant(date, clock);
const every = (start: string, min: number, count = 60) => Array.from({ length: count }, (_, i) => at(start) + i * min * MINUTE);

const legs: Leg[] = [
  { kind: "walk", min: 9 },
  { kind: "ride", line: "EWL", from: "EW17", to: "EW16", direction: "TO_EAST", rideMin: 3, tip: "Door 3-2" },
  { kind: "transfer", min: 2, at: "outram-park" },
  { kind: "ride", line: "TEL", from: "TE17", to: "TE19", direction: "TO_BAYSHORE", rideMin: 3 },
  { kind: "walk", min: 5 },
];
const timed: TrainSource = (leg) =>
  leg.line === "EWL"
    ? { kind: "times", times: every("07:02", 5), headwayMin: 5, confidence: "high" }
    : { kind: "times", times: every("07:03", 6), headwayMin: 6, confidence: "high" };
const reading = (station: string, line: string, direction: string, capturedAt: number, minutes: number[]): Observation => ({
  station,
  line,
  direction,
  capturedAt,
  minutes,
  source: "owner",
  status: "approved",
});

describe("home journey auto-select", () => {
  const journeys = [
    { key: "home_to_office", fromPlace: "home" },
    { key: "office_to_home", fromPlace: "office" },
    { key: "office_to_home_tp", fromPlace: "office" },
  ];
  it("before 14:00 SGT → Home→Office, from 14:00 → Office→Home", () => {
    expect(autoJourneyKey(journeys, at("06:30"))).toBe("home_to_office");
    expect(autoJourneyKey(journeys, at("13:59"))).toBe("home_to_office");
    expect(autoJourneyKey(journeys, at("14:00"))).toBe("office_to_home");
    expect(autoJourneyKey(journeys, at("20:00"))).toBe("office_to_home");
  });
  it("a manual choice wins for 2 h, then the time-of-day default returns", () => {
    const manual = { key: "office_to_home_tp", at: at("08:00") };
    expect(autoJourneyKey(journeys, at("08:00") + MANUAL_CHOICE_TTL_MS - 1, manual)).toBe("office_to_home_tp");
    expect(autoJourneyKey(journeys, at("08:00") + MANUAL_CHOICE_TTL_MS, manual)).toBe("home_to_office");
    expect(autoJourneyKey(journeys, at("09:00"), { key: "gone", at: at("08:59") })).toBe("home_to_office");
    expect(autoJourneyKey([], at("09:00"))).toBeUndefined();
  });
  it("round-trips the remembered choice cookie", () => {
    const choice = { key: "office_to_home", at: at("18:00") };
    expect(parseJourneyChoice(serializeJourneyChoice(choice))).toEqual(choice);
    expect(parseJourneyChoice("garbage")).toBeNull();
    expect(parseJourneyChoice(undefined)).toBeNull();
  });
});

describe("next departures", () => {
  it("lists 6 rows with strictly increasing leave times", () => {
    const rows = nextDepartures(legs, at("07:30"), timed);
    expect(rows).toHaveLength(6);
    for (let i = 1; i < rows.length; i++) expect(rows[i].leaveAt).toBeGreaterThan(rows[i - 1].leaveAt);
    for (const r of rows) {
      expect(r.ranged).toBe(false);
      expect(r.rides).toHaveLength(2);
      expect(r.leaveAt).toBeGreaterThanOrEqual(at("07:30"));
      expect(r.rides[0].boardAt).toBe(r.leaveAt + 9 * MINUTE); // walk 9 then board
      expect(r.rides[1].boardAt).toBeGreaterThanOrEqual(r.rides[0].boardAt + 5 * MINUTE); // ride 3 + transfer 2
      expect(r.arriveAt).toBe(r.rides[1].boardAt + 8 * MINUTE); // ride 3 + walk 5
      expect(["tight", "likely", "wait"]).toContain(r.rides[1].catch);
    }
    expect(rows[0].rides[0].tip).toBe("Door 3-2");
    // 07:30 + walk 9 = 07:39 → first EWL at 07:42 → leave 07:33.
    expect(sgtClock(rows[0].leaveAt)).toBe("07:33");
  });

  it("inside the weekday 09:15–10:30 unstable window, shows ranges not clocks", () => {
    // Monday readings at the same time would give clock times outside the window.
    const observations = [
      reading("EW17", "EWL", "TO_EAST", at("09:40", MON), [2, 7]),
      reading("TE17", "TEL", "TO_BAYSHORE", at("09:52", MON), [1, 7]),
    ];
    const rows = nextDepartures(legs, at("09:40"), predictionSource(observations));
    expect(rows).toHaveLength(6);
    for (let i = 1; i < rows.length; i++) expect(rows[i].leaveAt).toBeGreaterThan(rows[i - 1].leaveAt);
    const first = rows[0];
    expect(first.ranged).toBe(true);
    expect(first.rides[0].ranged).toBe(true);
    expect(first.rides[0].boardUntil).toBeGreaterThan(first.rides[0].boardAt);
    expect(first.rides[0].reason?.code).toBe("unstable_window");
    expect(first.worst).toBeGreaterThan(first.best);
  });

  it("a board reading today takes effect immediately (same-day anchor, high confidence)", () => {
    const now = at("11:00");
    const before = nextDepartures(legs, now, predictionSource([]));
    expect(before[0].ranged).toBe(true);
    const obs = [reading("EW17", "EWL", "TO_EAST", now, [12, 17])];
    const after = nextDepartures(legs, now, predictionSource(obs));
    expect(after[0].rides[0].ranged).toBe(false);
    expect(sgtClock(after[0].rides[0].boardAt)).toBe("11:12");
    expect(sgtClock(after[0].leaveAt)).toBe("11:03");
    expect(after[0].rides[0].confidence).toBe("high");
    expect(after[0].rides[0].reason?.code).toBe("reading_ago");
    expect(after[0].rides[0].anchorAt).toBe(now);
  });
});

describe("commute progress", () => {
  it("starts from the platform, the next leg after boarding, or the whole trip", () => {
    const now = at("08:00");
    expect(commuteProgress(legs, [], now)).toEqual({ state: "idle", fromLeg: 0, startAt: now });
    expect(commuteProgress(legs, [{ kind: "at_platform", station: "EW17", at: now - MINUTE }], now)).toMatchObject({ state: "at_platform", fromLeg: 1, startAt: now });
    const boarded = commuteProgress(
      legs,
      [
        { kind: "at_platform", station: "EW17", at: now - 3 * MINUTE },
        { kind: "board", station: "EW17", at: now - MINUTE },
      ],
      now,
    );
    expect(boarded).toEqual({ state: "on_board", fromLeg: 2, startAt: now + 2 * MINUTE });
    expect(commuteProgress(legs, [{ kind: "alight", station: "TE19", at: now }], now)).toMatchObject({ state: "between", fromLeg: 4 });
    expect(commuteProgress(legs, [{ kind: "arrived", at: now }], now).state).toBe("idle");
    expect(commuteProgress(legs, [{ kind: "at_platform", station: "EW17", at: now - 2 * 60 * MINUTE }], now).state).toBe("idle");
  });

  it("recomputes the view from the remaining legs", () => {
    const now = at("07:30");
    const view = commuteView("home_to_office", legs, { state: "at_platform", fromLeg: 1, startAt: now }, timed, now);
    expect(view.rows).toHaveLength(6);
    // Already on the platform: the first row boards the next EWL train (07:32).
    expect(sgtClock(view.rows[0].rides[0].boardAt)).toBe("07:32");
    expect(view.leaveNow?.rides[0].boardAt).toBe(view.rows[0].rides[0].boardAt);
    const done = commuteView("home_to_office", legs, { state: "between", fromLeg: legs.length, startAt: now }, timed, now);
    expect(done.rows).toEqual([]);
    expect(done.leaveNow).toBeNull();
  });
});
