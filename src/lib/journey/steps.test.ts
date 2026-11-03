import { describe, expect, it } from "vitest";
import { journeySteps, nextStepIndex, suggestedJourney } from "./steps";
import type { Leg } from "./plan";

const legs: Leg[] = [
  { kind: "walk", min: 9 },
  { kind: "ride", line: "EWL", from: "EW17", to: "EW16", direction: "TO_EAST" },
  { kind: "transfer", min: 2 },
  { kind: "ride", line: "TEL", from: "TE17", to: "TE19", direction: "TO_BAYSHORE" },
  { kind: "walk", min: 5 },
];

describe("journey-aware logging", () => {
  it("expects platform → board → alight per ride, then tap out and arrive", () => {
    const steps = journeySteps(legs);
    expect(steps.map((s) => s.kind)).toEqual(["at_platform", "board", "alight", "at_platform", "board", "alight", "tap_out", "arrived"]);
    expect(steps[4]).toEqual({ kind: "board", station: "TE17", line: "TEL", direction: "TO_BAYSHORE" });
  });
  it("knows the next step from what was logged", () => {
    const steps = journeySteps(legs);
    expect(nextStepIndex(steps, [])).toBe(0);
    expect(nextStepIndex(steps, [{ kind: "at_platform", station: "EW17" }, { kind: "board", station: "EW17" }])).toBe(2);
    expect(nextStepIndex(steps, [{ kind: "board", station: "TE17" }])).toBe(5);
    expect(nextStepIndex(steps, [{ kind: "tap_in" }])).toBe(0);
  });
  it("suggests the journey by time of day", () => {
    const js = [
      { key: "home_to_office", fromPlace: "home" },
      { key: "office_to_home", fromPlace: "office" },
    ];
    expect(suggestedJourney(js, 8)?.key).toBe("home_to_office");
    expect(suggestedJourney(js, 18)?.key).toBe("office_to_home");
  });
});
