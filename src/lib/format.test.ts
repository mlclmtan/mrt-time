import { describe, expect, it } from "vitest";
import { clock, clockSeconds, formatCountdownMin } from "./format";
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

describe("formatCountdownMin pure function", () => {
  it("formats 0–59 s as 'Now'", () => {
    expect(formatCountdownMin(0)).toBe("Now");
    expect(formatCountdownMin(1000)).toBe("Now");
    expect(formatCountdownMin(30_000)).toBe("Now");
    expect(formatCountdownMin(59_000)).toBe("Now");
    expect(formatCountdownMin(59_999)).toBe("Now");
  });

  it("formats 60–119 s as '1 min'", () => {
    expect(formatCountdownMin(60_000)).toBe("1 min");
    expect(formatCountdownMin(75_000)).toBe("1 min");
    expect(formatCountdownMin(119_000)).toBe("1 min");
    expect(formatCountdownMin(119_999)).toBe("1 min");
  });

  it("rounds DOWN to whole minutes", () => {
    expect(formatCountdownMin(120_000)).toBe("2 min");
    expect(formatCountdownMin(179_999)).toBe("2 min");
    expect(formatCountdownMin(5 * 60_000 + 45_000)).toBe("5 min");
    expect(formatCountdownMin(59 * 60_000 + 59_000)).toBe("59 min");
  });

  it("formats >= 60 min as '1 h 5 min' or '1 h'", () => {
    expect(formatCountdownMin(60 * 60_000)).toBe("1 h");
    expect(formatCountdownMin(65 * 60_000)).toBe("1 h 5 min");
    expect(formatCountdownMin(65 * 60_000 + 30_000)).toBe("1 h 5 min");
    expect(formatCountdownMin(125 * 60_000)).toBe("2 h 5 min");
  });

  it("supports zh-Hant locale", () => {
    expect(formatCountdownMin(0, "zh-Hant")).toBe("現在");
    expect(formatCountdownMin(30_000, "zh-Hant")).toBe("現在");
    expect(formatCountdownMin(60_000, "zh-Hant")).toBe("1 分鐘");
    expect(formatCountdownMin(120_000, "zh-Hant")).toBe("2 分鐘");
    expect(formatCountdownMin(60 * 60_000, "zh-Hant")).toBe("1 小時");
    expect(formatCountdownMin(65 * 60_000, "zh-Hant")).toBe("1 小時 5 分鐘");
  });
});
