import { describe, expect, it } from "vitest";
import { clock, clockSeconds } from "./format";
import { sgtInstant } from "./time";

describe("clock and clockSeconds formatters", () => {
  it("clock formats SGT hours and minutes", () => {
    const ts = sgtInstant("2026-11-10", "10:14");
    expect(clock(ts)).toBe("10:14");
  });

  it("clockSeconds formats SGT hours, minutes, and seconds", () => {
    const ts = sgtInstant("2026-11-10", "10:14") + 32_000;
    expect(clockSeconds(ts)).toBe("10:14:32");
  });

  it("clockSeconds handles midnight and UTC offset correctly for Singapore (+08:00)", () => {
    // 2026-11-10T00:00:00.000Z is 08:00:00 SGT
    const utcMidnight = Date.parse("2026-11-10T00:00:00.000Z");
    expect(clockSeconds(utcMidnight)).toBe("08:00:00");

    // SGT midnight (16:00:00 UTC previous day)
    const sgtMidnight = sgtInstant("2026-11-10", "00:00");
    expect(clockSeconds(sgtMidnight)).toBe("00:00:00");
    expect(clockSeconds(sgtMidnight + 59_000)).toBe("00:00:59");
  });
});
