import { describe, expect, it } from "vitest";
import {
  defaultStationTab,
  getInitialUsage,
  hasStationUsage,
  isPinned,
  loadUsage,
  rankFrequent,
  recent,
  recordStationUse,
  recordUse,
  scoreStation,
  THIRTY_DAYS_MS,
  togglePin,
  toggleStationPin,
  type StationUsageState,
  type Store,
} from "./usage";

describe("Station usage logic", () => {
  const NOW = 1_700_000_000_000;

  it("records a station use with count and lastUsed", () => {
    let state = getInitialUsage();
    state = recordUse(state, "tiong-bahru", NOW, "view");

    expect(state.stations["tiong-bahru"]?.count).toBe(1);
    expect(state.stations["tiong-bahru"]?.lastUsed).toBe(NOW);
    expect(state.stations["tiong-bahru"]?.uses).toHaveLength(1);
    expect(state.stations["tiong-bahru"]?.uses?.[0]).toEqual({
      timestamp: NOW,
      kind: "view",
    });

    // Record second use later
    state = recordUse(state, "tiong-bahru", NOW + 5000, "boarding");
    expect(state.stations["tiong-bahru"]?.count).toBe(2);
    expect(state.stations["tiong-bahru"]?.lastUsed).toBe(NOW + 5000);
    expect(state.stations["tiong-bahru"]?.uses).toHaveLength(2);
  });

  it("filters out granular uses older than 90 days when recording", () => {
    let state = getInitialUsage();
    const oldTime = NOW - 100 * 24 * 60 * 60 * 1000;
    state = recordUse(state, "tiong-bahru", oldTime, "view");
    expect(state.stations["tiong-bahru"]?.uses).toHaveLength(1);

    // Adding a use at NOW prunes the 100-day-old use from uses[], while count increments
    state = recordUse(state, "tiong-bahru", NOW, "view");
    expect(state.stations["tiong-bahru"]?.count).toBe(2);
    expect(state.stations["tiong-bahru"]?.uses).toHaveLength(1);
    expect(state.stations["tiong-bahru"]?.uses?.[0].timestamp).toBe(NOW);
  });

  it("toggles pins up to maximum 3", () => {
    let state = getInitialUsage();

    state = togglePin(state, "tiong-bahru");
    expect(state.pins).toEqual(["tiong-bahru"]);
    expect(isPinned(state, "tiong-bahru")).toBe(true);

    state = togglePin(state, "outram-park");
    state = togglePin(state, "shenton-way");
    expect(state.pins).toEqual(["tiong-bahru", "outram-park", "shenton-way"]);

    // Attempting 4th pin should be ignored
    state = togglePin(state, "maxwell");
    expect(state.pins).toEqual(["tiong-bahru", "outram-park", "shenton-way"]);
    expect(isPinned(state, "maxwell")).toBe(false);

    // Unpinning one works
    state = togglePin(state, "outram-park");
    expect(state.pins).toEqual(["tiong-bahru", "shenton-way"]);
    expect(isPinned(state, "outram-park")).toBe(false);

    // Now 3rd pin can be added
    state = togglePin(state, "maxwell");
    expect(state.pins).toEqual(["tiong-bahru", "shenton-way", "maxwell"]);
  });

  describe("rankFrequent with 30-day recency decay", () => {
    it("ranks higher count first when used recently", () => {
      let state = getInitialUsage();
      state = recordUse(state, "station-a", NOW, "view");
      state = recordUse(state, "station-a", NOW, "view");
      state = recordUse(state, "station-b", NOW, "view");

      const ranked = rankFrequent(state, NOW);
      expect(ranked).toEqual(["station-a", "station-b"]);
    });

    it("decays count with 30-day half-life so recent lower-count beats old high-count", () => {
      let state = getInitialUsage();
      const sixtyDaysAgo = NOW - 60 * 24 * 60 * 60 * 1000;

      // Station Old: 10 uses 60 days ago (decay factor: 0.5^2 = 0.25 -> score = 2.5)
      for (let i = 0; i < 10; i++) {
        state = recordUse(state, "station-old", sixtyDaysAgo, "view");
      }

      // Station New: 5 uses today (decay factor: 1 -> score = 5.0)
      for (let i = 0; i < 5; i++) {
        state = recordUse(state, "station-new", NOW, "view");
      }

      const ranked = rankFrequent(state, NOW);
      expect(ranked).toEqual(["station-new", "station-old"]);
    });

    it("calculates scoreStation correctly for single 30-day old record", () => {
      const thirtyDaysAgo = NOW - THIRTY_DAYS_MS;
      const recordSingle = { count: 1, lastUsed: thirtyDaysAgo, uses: [{ timestamp: thirtyDaysAgo }] };
      expect(scoreStation(recordSingle, NOW)).toBeCloseTo(0.5, 2);

      const recordTen = { count: 10, lastUsed: thirtyDaysAgo, uses: [{ timestamp: thirtyDaysAgo }] };
      expect(scoreStation(recordTen, NOW)).toBeCloseTo(5.0, 2);
    });

    it("falls back to count * decay when uses array is absent", () => {
      const thirtyDaysAgo = NOW - THIRTY_DAYS_MS;
      const record = { count: 10, lastUsed: thirtyDaysAgo };
      const score = scoreStation(record, NOW);
      // 10 * 0.5 = 5.0
      expect(score).toBeCloseTo(5.0, 2);
    });

    it("tie-breaks by lastUsed then alphabetical slug", () => {
      const state: StationUsageState = {
        pins: [],
        stations: {
          "station-b": { count: 2, lastUsed: NOW, uses: [{ timestamp: NOW }, { timestamp: NOW }] },
          "station-a": { count: 2, lastUsed: NOW, uses: [{ timestamp: NOW }, { timestamp: NOW }] },
        },
      };

      const ranked = rankFrequent(state, NOW);
      expect(ranked).toEqual(["station-a", "station-b"]);
    });

    it("handles raw StationRecord dictionary input", () => {
      const dict = {
        "station-x": { count: 3, lastUsed: NOW },
        "station-y": { count: 1, lastUsed: NOW },
      };
      expect(rankFrequent(dict, NOW)).toEqual(["station-x", "station-y"]);
    });

    it("returns empty array when there is no usage", () => {
      expect(rankFrequent(getInitialUsage(), NOW)).toEqual([]);
      expect(rankFrequent({}, NOW)).toEqual([]);
    });
  });

  describe("recent stations", () => {
    it("returns stations ordered newest first, limited to n (default 5)", () => {
      let state = getInitialUsage();
      for (let i = 1; i <= 7; i++) {
        state = recordUse(state, `station-${i}`, NOW + i * 1000);
      }

      const list = recent(state);
      expect(list).toEqual(["station-7", "station-6", "station-5", "station-4", "station-3"]);
    });

    it("excludes specified stations (e.g. pinned)", () => {
      let state = getInitialUsage();
      state = recordUse(state, "station-a", NOW + 1000);
      state = recordUse(state, "station-b", NOW + 2000);
      state = recordUse(state, "station-c", NOW + 3000);

      const list = recent(state, 5, ["station-c"]);
      expect(list).toEqual(["station-b", "station-a"]);
    });
  });

  describe("storage wrapper", () => {
    it("safely loads and saves using a mock store", () => {
      const memory: Record<string, string> = {};
      const mockStore: Store = {
        getItem: (k) => memory[k] ?? null,
        setItem: (k, v) => {
          memory[k] = v;
        },
        removeItem: (k) => {
          delete memory[k];
        },
      };

      expect(loadUsage(mockStore)).toEqual(getInitialUsage());

      recordStationUse("tiong-bahru", NOW, "view", mockStore);
      const afterRecord = loadUsage(mockStore);
      expect(afterRecord.stations["tiong-bahru"]?.count).toBe(1);

      toggleStationPin("tiong-bahru", mockStore);
      const afterPin = loadUsage(mockStore);
      expect(afterPin.pins).toEqual(["tiong-bahru"]);
    });

    it("handles null store without errors (SSR-safe)", () => {
      expect(loadUsage(null)).toEqual(getInitialUsage());
      expect(recordStationUse("test", NOW, "view", null)).toBeDefined();
      expect(toggleStationPin("test", null)).toBeDefined();
    });
  });

  describe("hasStationUsage & defaultStationTab", () => {
    it("returns false and defaults to 'line' when there is no usage history", () => {
      expect(hasStationUsage(null)).toBe(false);
      expect(hasStationUsage(undefined)).toBe(false);
      expect(hasStationUsage(getInitialUsage())).toBe(false);
      expect(hasStationUsage({ stations: {}, pins: [] })).toBe(false);
      expect(defaultStationTab(getInitialUsage())).toBe("line");
    });

    it("returns false and defaults to 'line' when station records have zero count", () => {
      const emptyUsage: StationUsageState = {
        pins: [],
        stations: { "outram-park": { count: 0, lastUsed: 0 } },
      };
      expect(hasStationUsage(emptyUsage)).toBe(false);
      expect(defaultStationTab(emptyUsage)).toBe("line");
    });

    it("returns true and defaults to 'frequent' when stations are pinned", () => {
      const pinnedUsage: StationUsageState = {
        pins: ["outram-park"],
        stations: {},
      };
      expect(hasStationUsage(pinnedUsage)).toBe(true);
      expect(defaultStationTab(pinnedUsage)).toBe("frequent");
    });

    it("returns true and defaults to 'frequent' when stations have recorded uses", () => {
      let state = getInitialUsage();
      state = recordUse(state, "tiong-bahru", NOW, "view");
      expect(hasStationUsage(state)).toBe(true);
      expect(defaultStationTab(state)).toBe("frequent");
    });
  });
});
