import { describe, expect, it } from "vitest";
import { PULL_MAX_PX, PULL_TRIGGER_PX, pullDistance, pullPhase } from "./pull-refresh";

describe("pull to refresh", () => {
  it("ignores upward or zero movement", () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(-40)).toBe(0);
    expect(pullDistance(Number.NaN)).toBe(0);
  });
  it("applies resistance and caps the indicator", () => {
    expect(pullDistance(100)).toBe(50);
    expect(pullDistance(1000)).toBe(PULL_MAX_PX);
  });
  it("switches to release at the trigger and to refreshing while reloading", () => {
    expect(pullPhase(0, false)).toBe("idle");
    expect(pullPhase(PULL_TRIGGER_PX - 1, false)).toBe("pull");
    expect(pullPhase(PULL_TRIGGER_PX, false)).toBe("release");
    expect(pullPhase(10, true)).toBe("refreshing");
  });
});
