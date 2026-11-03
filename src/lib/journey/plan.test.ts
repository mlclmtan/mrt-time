import { describe, expect, it } from "vitest";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import {
  directionBetween,
  findRoutes,
  inService,
  LINES,
  rideMinutes,
  transferMinutes,
} from "../network";
import { planForward, planLeaveBy, planList, routeToLegs, type Leg, type TrainSource } from "./plan";
import { isRainy, scheduleFromPrediction, shelteredSuggestion } from "./source";

const D = "2026-11-02";
const at = (clock: string) => sgtInstant(D, clock);
const every = (start: string, min: number, count = 40) =>
  Array.from({ length: count }, (_, i) => at(start) + i * min * MINUTE);

// Synthetic home → office: walk 9 → EWL 3 min → transfer 2 → TEL 3 min → walk 5.
const legs: Leg[] = [
  { kind: "walk", min: 9 },
  { kind: "ride", line: "EWL", from: "EW17", to: "EW16", direction: "TO_EAST", rideMin: 3 },
  { kind: "transfer", min: 2, at: "outram-park" },
  { kind: "ride", line: "TEL", from: "TE17", to: "TE19", direction: "TO_BAYSHORE", rideMin: 3 },
  { kind: "walk", min: 5 },
];
const source: TrainSource = (leg) =>
  leg.line === "EWL"
    ? { kind: "times", times: every("10:22", 5), headwayMin: 5, confidence: "high" }
    : { kind: "times", times: every("10:23", 6), headwayMin: 6, confidence: "high" };

describe("journey planner", () => {
  it("leaving at 10:13 boards EWL 10:22, TEL 10:29 and arrives 10:37", () => {
    const plan = planForward(legs, at("10:13"), source);
    const rides = plan.legs.filter((l) => l.leg.kind === "ride");
    expect(sgtClock(rides[0].boardAt!)).toBe("10:22");
    expect(sgtClock(rides[1].boardAt!)).toBe("10:29");
    expect(sgtClock(plan.arriveAt)).toBe("10:37");
    expect(rides[0].catch).toBe("tight");
    expect(rides[1].catch).toBe("likely"); // 2 min slack at the transfer
    expect(plan.best).toBeLessThanOrEqual(plan.arriveAt);
    expect(plan.worst).toBeGreaterThan(plan.arriveAt);
  });

  it("leave-by mode inverts it: arrive by 10:37 → leave 10:13", () => {
    const plan = planLeaveBy(legs, at("10:37"), source);
    expect(sgtClock(plan.departAt)).toBe("10:13");
    expect(sgtClock(plan.arriveAt)).toBe("10:37");
    // A minute earlier target needs the earlier connection.
    const earlier = planLeaveBy(legs, at("10:36"), source);
    expect(earlier.arriveAt).toBeLessThanOrEqual(at("10:36"));
    expect(earlier.departAt).toBeLessThan(at("10:13"));
  });

  it("list mode returns 6 options sorted by departure", () => {
    const list = planList(legs, at("10:13"), source);
    expect(list).toHaveLength(6);
    for (let i = 1; i < list.length; i++) {
      expect(list[i].departAt).toBeGreaterThan(list[i - 1].departAt);
      expect(list[i].arriveAt).toBeGreaterThanOrEqual(list[i - 1].arriveAt);
    }
    expect(sgtClock(list[0].departAt)).toBe("10:13");
    expect(sgtClock(list[0].arriveAt)).toBe("10:37");
    expect(sgtClock(list[1].departAt)).toBe("10:18");
  });

  it("handles headway-only legs with a best/worst spread", () => {
    const vague: TrainSource = () => ({ kind: "headway", headwayMin: 6, confidence: "low" });
    const plan = planForward(legs, at("10:13"), vague);
    expect(plan.confidence).toBe("low");
    expect(plan.worst - plan.best).toBe(12 * MINUTE);
    expect(plan.legs.find((l) => l.leg.kind === "ride")!.catch).toBe("wait");
  });

  it("turns predictions into schedules", () => {
    expect(
      scheduleFromPrediction({
        kind: "range",
        arrivals: [],
        headwayMin: 5,
        waitMin: { min: 0, max: 5 },
        confidence: "low",
        basis: "band",
        reason: { code: "typical_gap", params: {} },
        band: "weekday_offpeak",
        unstable: false,
      }),
    ).toEqual({ kind: "headway", headwayMin: 5, confidence: "low", reason: { code: "typical_gap", params: {} } });
  });
});

describe("network", () => {
  it("knows directions, ride minutes and transfers", () => {
    expect(directionBetween("EW17", "EW16")?.key).toBe("TO_EAST");
    expect(directionBetween("EW15", "EW17")?.key).toBe("TO_WEST");
    expect(directionBetween("TE17", "TE19")?.key).toBe("TO_BAYSHORE");
    expect(directionBetween("NE3", "NE1")?.key).toBe("TO_HARBOURFRONT");
    expect(rideMinutes("EW17", "EW16")).toBe(3);
    expect(rideMinutes("EW15", "EW17")).toBe(5);
    expect(rideMinutes("TE14", "TE17")).toBe(6); // 3 stops × 2 min default
    // Outram Park estimates: EW↔TE observed 1–2 min (median 2).
    expect(transferMinutes("EW16", "TE17")).toBe(2);
    expect(transferMinutes("TE17", "EW16")).toBe(2);
    expect(transferMinutes("NE3", "EW16")).toBe(3);
    expect(transferMinutes("EW16", "NE3")).toBe(3);
    expect(transferMinutes("NE3", "TE17")).toBe(4);
    expect(transferMinutes("TE17", "NE3")).toBe(4);
  });

  it("service hours run past midnight", () => {
    expect(inService(LINES.EWL, sgtInstant(D, "05:29"))).toBe(false);
    expect(inService(LINES.EWL, sgtInstant(D, "05:31"))).toBe(true);
    expect(inService(LINES.EWL, sgtInstant(D, "00:20"))).toBe(true);
    expect(inService(LINES.EWL, sgtInstant(D, "01:00"))).toBe(false);
  });

  it("routes between stations with at most two transfers", () => {
    const direct = findRoutes("tiong-bahru", "tanjong-pagar");
    expect(direct[0].transfers).toBe(0);
    const one = findRoutes("tiong-bahru", "shenton-way");
    expect(one[0].transfers).toBe(1);
    expect(one[0].steps.map((s) => s.kind)).toEqual(["ride", "transfer", "ride"]);
    // Public routing uses the Outram EW16 → TE17 estimate (2 min, not 4).
    expect(one[0].steps[1]).toMatchObject({ kind: "transfer", at: "outram-park", from: "EW16", to: "TE17", min: 2 });
    for (const r of findRoutes("redhill", "punggol-coast"))
      for (const s of r.steps) if (s.kind === "transfer") expect(s.min).toBeLessThanOrEqual(4);
    const legs = routeToLegs(one[0], 9, 5);
    expect(legs[0]).toEqual({ kind: "walk", min: 9 });
    expect(legs.at(-1)).toEqual({ kind: "walk", min: 5 });
    const orchardToHarbourfront = findRoutes("orchard", "harbourfront");
    expect(orchardToHarbourfront[0].transfers).toBe(1);
    expect(findRoutes("tiong-bahru", "shenton-way", 0)).toEqual([]);
    for (const r of findRoutes("redhill", "punggol-coast")) expect(r.transfers).toBeLessThanOrEqual(2);
    expect(findRoutes("nowhere", "orchard")).toEqual([]);
  });

  it("rain hints suggest the sheltered variant", () => {
    expect(isRainy("Light Showers")).toBe(true);
    expect(isRainy("Thundery Showers")).toBe(true);
    expect(isRainy("Partly Cloudy (Day)")).toBe(false);
    const options = [
      { id: 1, sheltered: false },
      { id: 2, sheltered: true },
    ];
    expect(shelteredSuggestion(options, true)?.id).toBe(2);
    expect(shelteredSuggestion(options, false)).toBeNull();
  });
});
