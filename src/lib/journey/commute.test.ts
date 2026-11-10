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
  parseDismissed,
  parseJourneyChoice,
  resolveTrip,
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
    expect(boarded).toEqual({ state: "on_board", fromLeg: 2, startAt: now + 2 * MINUTE }); // boarded 07:59 + 3 min ride
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

describe("stale 'on board' (H1, live 2026-11-10)", () => {
  // Owner logged: boarded EW17 10:14, boarded TE17 10:17 (no "got off" logged), Home→Office.
  const taps = [
    { kind: "board", station: "EW17", at: at("10:14") },
    { kind: "board", station: "TE17", at: at("10:17") },
  ];

  it("plans the rest of the trip from the tap times, not from now", () => {
    const p = commuteProgress(legs, taps, at("10:19"));
    // TE17 → TE19 is 3 min: the ride ends ~10:20 whatever the clock says.
    expect(p).toEqual({ state: "on_board", fromLeg: 4, startAt: at("10:20") });
    expect(commuteProgress(legs, taps, at("10:35")).startAt).toBe(at("10:20"));
    const view = commuteView("home_to_office", legs, p, timed, at("10:19"));
    expect(sgtClock(view.leaveNow!.arriveAt)).toBe("10:25"); // + 5 min walk
    expect(view.rows).toEqual([]);
  });

  it("is finished ('Arrived ~10:25?') once now is past the expected arrival + 15 min — never 'on board' at 11:19", () => {
    const at1039 = commuteView("home_to_office", legs, commuteProgress(legs, taps, at("10:39")), timed, at("10:39"));
    expect(at1039.progress.state).toBe("on_board");
    const at1041 = commuteView("home_to_office", legs, commuteProgress(legs, taps, at("10:41")), timed, at("10:41"));
    expect(at1041.progress).toMatchObject({ state: "finished", arrivedAt: at("10:25") });
    // Under the prompt: the whole journey again from now (the next trip), never the old ride.
    expect(at1041.leaveNow!.leaveAt).toBeGreaterThanOrEqual(at("10:41"));
    expect(at1041.rows[0].rides).toHaveLength(2);
    const at1119 = commuteView("home_to_office", legs, commuteProgress(legs, taps, at("11:19")), timed, at("11:19"));
    expect(at1119.progress.state).toBe("finished");
    expect(sgtClock(at1119.progress.arrivedAt!)).toBe("10:25");
  });

  it("got off and changing: the change starts when you got off", () => {
    const off = [...taps.slice(0, 1), { kind: "alight", station: "EW16", at: at("10:17") }];
    const p = commuteProgress(legs, off, at("10:18"));
    expect(p).toEqual({ state: "between", fromLeg: 2, startAt: at("10:17") });
    const view = commuteView("home_to_office", legs, p, timed, at("10:18"));
    // 2-min change → TEL trains every 6 from 07:03 → 10:21; + 3 + 5 → 10:29.
    expect(sgtClock(view.leaveNow!.rides[0].boardAt)).toBe("10:21");
    expect(sgtClock(view.leaveNow!.arriveAt)).toBe("10:29");
  });
});

describe("one next-step resolver (v2.1.1 live check, 10 Nov 12:10)", () => {
  // Today: boarded EW17 TO_EAST 10:14, boarded TE17 TO_BAYSHORE 10:17, nothing after.
  const NOV10 = "2026-11-10";
  const t = (clock: string, date = NOV10) => at(clock, date);
  const homeToOffice = { legs, fromPlace: "home", toPlace: "office" };
  const officeToHome = { legs, fromPlace: "office", toPlace: "home" };
  const taps = [
    { kind: "board", station: "EW17", at: t("10:14") },
    { kind: "board", station: "TE17", at: t("10:17") },
  ];

  it("at 12:10 (taps 113 min old) the trip is finished: 'Arrived ~10:25?', next = the desk", () => {
    const trip = resolveTrip(homeToOffice, taps, t("12:10"));
    expect(trip.progress).toMatchObject({ state: "finished", arrivedAt: t("10:25") });
    expect(trip.next).toEqual({ kind: "desk", role: "end" });
    expect(trip.lastTapAt).toBe(t("10:17"));
    // Not "Got off · Shenton Way" (the step after the last tap).
    expect(trip.next?.kind).not.toBe("alight");
    // The card gets the same state: prompt + the whole journey planned from 12:10.
    const view = commuteView("home_to_office", legs, trip.progress, timed, t("12:10"));
    expect(view.progress).toMatchObject({ state: "finished", arrivedAt: t("10:25") });
    expect(view.leaveNow!.leaveAt).toBeGreaterThanOrEqual(t("12:10"));
    expect(view.rows.length).toBeGreaterThan(0);
  });

  it("still on board within the trip, finished from arrival + 15 min (10:40) on", () => {
    expect(resolveTrip(homeToOffice, taps, t("10:19")).next).toMatchObject({ kind: "alight", station: "TE19", role: "step" });
    expect(resolveTrip(homeToOffice, taps, t("10:39")).progress.state).toBe("on_board");
    expect(resolveTrip(homeToOffice, taps, t("10:41")).next).toEqual({ kind: "desk", role: "end" });
  });

  it("after Dismiss, a new day or a new journey, the next step is the journey's first (Home door / Left desk)", () => {
    const dismissed = resolveTrip(homeToOffice, taps, t("12:10"), { dismissedAt: t("10:17") });
    expect(dismissed.progress.state).toBe("idle");
    expect(dismissed.next).toEqual({ kind: "door", role: "start" });
    expect(dismissed.stepIdx).toBe(0);
    // Next day: yesterday's taps don't count.
    expect(resolveTrip(homeToOffice, taps, t("08:00", "2026-11-11")).next).toEqual({ kind: "door", role: "start" });
    // Office → Home (its own taps only): "Left desk".
    expect(resolveTrip(officeToHome, [], t("18:00")).next).toEqual({ kind: "desk", role: "start" });
  });

  it("logging the desk ends the trip; a start tap begins a new one", () => {
    const desk = [...taps, { kind: "desk", at: t("10:27") }];
    expect(resolveTrip(homeToOffice, desk, t("10:30")).next).toEqual({ kind: "door", role: "start" });
    const door = [...desk, { kind: "door", at: t("18:00") }];
    expect(resolveTrip(homeToOffice, door, t("18:01")).next).toMatchObject({ kind: "at_platform", station: "EW17" });
  });

  it("a tap made after the trip finished starts a new trip; an abandoned platform tap is forgotten", () => {
    const again = [...taps, { kind: "board", station: "EW17", at: t("12:20") }];
    const trip = resolveTrip(homeToOffice, again, t("12:21"));
    expect(trip.taps).toHaveLength(1);
    expect(trip.progress.state).toBe("on_board");
    expect(trip.next).toMatchObject({ kind: "alight", station: "EW16" });
    const abandoned = resolveTrip(homeToOffice, [{ kind: "at_platform", station: "EW17", at: t("08:00") }], t("10:00"));
    expect(abandoned.next).toEqual({ kind: "door", role: "start" });
  });

  it("honours the server's finished view while moving, and parses the Dismiss cookie", () => {
    const trip = resolveTrip(homeToOffice, taps, t("10:30"), { serverFinishedAt: t("10:26") });
    expect(trip.progress).toMatchObject({ state: "finished", arrivedAt: t("10:26") });
    expect(trip.next).toEqual({ kind: "desk", role: "end" });
    expect(parseDismissed(String(t("10:17")))).toBe(t("10:17"));
    expect(parseDismissed("nope")).toBeNull();
  });
});
