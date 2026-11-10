import { describe, expect, it } from "vitest";
import { MINUTE, sgtInstant } from "../time";
import { hopMinutes, rideMinutes } from "../network";
import { learnRideTimes, type RideTap } from "./rides";
import { trainAt, type TrainSighting } from "./sightings";

const at = (date: string, clock: string) => sgtInstant(date, clock);
const ride = (date: string, from: string, to: string, boardClock: string, minutes: number, direction = "TO_EAST"): RideTap[] => [
  { userId: "u", kind: "board", at: at(date, boardClock), station: from, direction },
  { userId: "u", kind: "alight", at: at(date, boardClock) + minutes * MINUTE, station: to, direction },
];

describe("ride times learned from the owner's trips (F11)", () => {
  it("median of ≥ 3 board → got-off pairs; fewer samples are ignored", () => {
    const taps = [
      ...ride("2026-11-02", "EW17", "EW16", "08:10", 2.5),
      ...ride("2026-11-03", "EW17", "EW16", "08:12", 2),
      ...ride("2026-11-04", "EW17", "EW16", "08:11", 3.5),
      ...ride("2026-11-04", "TE17", "TE19", "08:20", 4, "TO_BAYSHORE"),
    ];
    expect(learnRideTimes(taps)).toEqual({ "EW17>EW16": 2.5 });
  });

  it("skips pairs on different lines, other directions, with a tap in between, or longer than 2 h", () => {
    const taps: RideTap[] = [
      { userId: "u", kind: "board", at: at("2026-11-02", "08:00"), station: "EW17", direction: "TO_EAST" },
      { userId: "u", kind: "alight", at: at("2026-11-02", "08:03"), station: "TE17", direction: "TO_BAYSHORE" },
      { userId: "u", kind: "board", at: at("2026-11-02", "09:00"), station: "EW17", direction: "TO_EAST" },
      { userId: "u", kind: "at_platform", at: at("2026-11-02", "09:01"), station: "EW16", direction: null },
      { userId: "u", kind: "alight", at: at("2026-11-02", "09:03"), station: "EW16", direction: "TO_EAST" },
      { userId: "u", kind: "board", at: at("2026-11-02", "10:00"), station: "EW17", direction: "TO_EAST" },
      { userId: "u", kind: "alight", at: at("2026-11-02", "12:30"), station: "EW16", direction: "TO_EAST" },
    ];
    expect(learnRideTimes(taps, 1)).toEqual({});
  });

  it("learned minutes win over the defaults for propagation (and only when given)", () => {
    const learned = learnRideTimes([
      ...ride("2026-11-02", "EW25", "EW24", "08:10", 3),
      ...ride("2026-11-03", "EW25", "EW24", "08:10", 3),
      ...ride("2026-11-04", "EW25", "EW24", "08:10", 3),
    ]);
    expect(hopMinutes("EW25", "EW24")).toBe(2);
    expect(hopMinutes("EW25", "EW24", learned)).toBe(3);
    expect(rideMinutes("EW25", "EW24")).toBe(2); // the planner keeps the static figures
    const s: TrainSighting = { station: "EW25", line: "EWL", direction: "TO_EAST", at: at("2026-11-05", "08:00"), kind: "boarded", source: "owner", status: "approved" };
    expect((trainAt(s, "EW24", { rides: learned })!.at - s.at) / MINUTE).toBe(3);
  });
});
