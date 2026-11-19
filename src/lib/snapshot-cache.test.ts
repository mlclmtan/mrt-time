import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  cacheKey,
  safeParseSnapshot,
  isFresh,
  ageLabel,
  getSnapshot,
  saveSnapshot,
  clearSnapshot,
} from "./snapshot-cache";

describe("snapshot-cache pure helpers", () => {
  it("formats cache key with prefix", () => {
    expect(cacheKey("trip:home_to_office")).toBe("mrt:snap:v1:trip:home_to_office");
    expect(cacheKey("board:orchard")).toBe("mrt:snap:v1:board:orchard");
    expect(cacheKey("stations")).toBe("mrt:snap:v1:stations");
  });

  describe("safeParseSnapshot (JSON guard against corrupt data)", () => {
    it("returns null for null, empty or invalid JSON", () => {
      expect(safeParseSnapshot(null)).toBeNull();
      expect(safeParseSnapshot("")).toBeNull();
      expect(safeParseSnapshot("not-json")).toBeNull();
      expect(safeParseSnapshot("{ corrupt")).toBeNull();
      expect(safeParseSnapshot("123")).toBeNull();
      expect(safeParseSnapshot('"string"')).toBeNull();
      expect(safeParseSnapshot("true")).toBeNull();
    });

    it("returns null when savedAt is missing or invalid", () => {
      expect(safeParseSnapshot(JSON.stringify({ data: { a: 1 } }))).toBeNull();
      expect(safeParseSnapshot(JSON.stringify({ data: { a: 1 }, savedAt: "yesterday" }))).toBeNull();
      expect(safeParseSnapshot(JSON.stringify({ data: { a: 1 }, savedAt: NaN }))).toBeNull();
    });

    it("returns null when data field is missing", () => {
      expect(safeParseSnapshot(JSON.stringify({ savedAt: 12345 }))).toBeNull();
    });

    it("successfully parses valid record", () => {
      const parsed = safeParseSnapshot(JSON.stringify({ data: { count: 42 }, savedAt: 1000 }));
      expect(parsed).toEqual({ data: { count: 42 }, savedAt: 1000 });
    });
  });

  describe("isFresh", () => {
    const now = 1_000_000;

    it("returns true when age is within threshold (default 2 min = 120,000 ms)", () => {
      expect(isFresh(now, now)).toBe(true);
      expect(isFresh(now - 60_000, now)).toBe(true); // 1 min old
      expect(isFresh(now - 120_000, now)).toBe(true); // 2 min old
    });

    it("returns false when age exceeds threshold", () => {
      expect(isFresh(now - 120_001, now)).toBe(false); // > 2 min old
      expect(isFresh(now - 300_000, now)).toBe(false); // 5 min old
      expect(isFresh(now - 3600_000, now)).toBe(false); // 1 hr old
    });

    it("respects custom maxAgeMs", () => {
      expect(isFresh(now - 60_000, now, 30_000)).toBe(false);
      expect(isFresh(now - 60_000, now, 90_000)).toBe(true);
    });

    it("handles invalid inputs safely", () => {
      expect(isFresh(NaN, now)).toBe(false);
    });
  });

  describe("ageLabel", () => {
    const now = 10_000_000;

    it("returns null for fresh data (<= 2 min old)", () => {
      expect(ageLabel(now, now)).toBeNull();
      expect(ageLabel(now - 60_000, now)).toBeNull(); // 1 min
      expect(ageLabel(now - 120_000, now)).toBeNull(); // 2 min
    });

    it("returns 'Updated X min ago' for data between 2 min and 30 min old", () => {
      expect(ageLabel(now - 180_000, now)).toBe("Updated 3 min ago"); // 3 min
      expect(ageLabel(now - 600_000, now)).toBe("Updated 10 min ago"); // 10 min
      expect(ageLabel(now - 30 * 60_000, now)).toBe("Updated 30 min ago"); // 30 min
    });

    it("returns 'Offline copy · X min old' for data older than 30 min", () => {
      expect(ageLabel(now - 35 * 60_000, now)).toBe("Offline copy · 35 min old");
      expect(ageLabel(now - 60 * 60_000, now)).toBe("Offline copy · 60 min old");
    });

    it("supports zh-Hant localization", () => {
      expect(ageLabel(now - 180_000, now, "zh-Hant")).toBe("更新於 3 分鐘前");
      expect(ageLabel(now - 35 * 60_000, now, "zh-Hant")).toBe("離線快照 · 35 分鐘前");
    });

    it("handles invalid savedAt safely", () => {
      expect(ageLabel(NaN, now)).toBeNull();
    });
  });

  describe("localStorage interaction", () => {
    let mockStore: Record<string, string> = {};

    beforeEach(() => {
      mockStore = {};
      vi.stubGlobal("window", {
        localStorage: {
          getItem: (key: string) => mockStore[key] ?? null,
          setItem: (key: string, val: string) => {
            mockStore[key] = val;
          },
          removeItem: (key: string) => {
            delete mockStore[key];
          },
        },
      });
    });

    it("saves and retrieves snapshots", () => {
      saveSnapshot("test-key", { hello: "world" }, 12345);
      expect(mockStore["mrt:snap:v1:test-key"]).toBe(
        JSON.stringify({ data: { hello: "world" }, savedAt: 12345 }),
      );

      const retrieved = getSnapshot<{ hello: string }>("test-key");
      expect(retrieved).toEqual({ data: { hello: "world" }, savedAt: 12345 });
    });

    it("clears snapshot", () => {
      saveSnapshot("test-key", 123);
      clearSnapshot("test-key");
      expect(getSnapshot("test-key")).toBeNull();
    });

    it("handles corrupt localStorage data by returning null", () => {
      mockStore["mrt:snap:v1:bad"] = "corrupt json{";
      expect(getSnapshot("bad")).toBeNull();
    });
  });
});
