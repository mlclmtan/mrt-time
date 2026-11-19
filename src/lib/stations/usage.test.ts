import { describe, expect, it } from "vitest";
import { STATIONS } from "@/lib/network";
import {
  buildStationSections,
  defaultStationTab,
  getInitialUsage,
  hasStationUsage,
  isPinned,
  loadUsage,
  orderStationPlatforms,
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
    it("returns false for hasStationUsage and defaultStationTab defaults to 'frequent'", () => {
      expect(hasStationUsage(null)).toBe(false);
      expect(hasStationUsage(undefined)).toBe(false);
      expect(hasStationUsage(getInitialUsage())).toBe(false);
      expect(hasStationUsage({ stations: {}, pins: [] })).toBe(false);
      expect(defaultStationTab(getInitialUsage())).toBe("frequent");
    });

    it("returns false for hasStationUsage when station records have zero count", () => {
      const emptyUsage: StationUsageState = {
        pins: [],
        stations: { "outram-park": { count: 0, lastUsed: 0 } },
      };
      expect(hasStationUsage(emptyUsage)).toBe(false);
      expect(defaultStationTab(emptyUsage)).toBe("frequent");
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

  describe("buildStationSections pure function", () => {
    const pins = ["outram-park", "tiong-bahru"];
    const recent = ["tiong-bahru", "shenton-way", "harbourfront"]; // Note: tiong-bahru overlaps with pins

    it("in Frequent mode: pinned, recent (excluding pinned), and all (excluding pinned and recent)", () => {
      const sections = buildStationSections({
        stations: STATIONS,
        pins,
        recent,
        mode: "frequent",
      });

      expect(sections.map((s) => s.id)).toEqual(["pinned", "recent", "all"]);

      const pinnedSlugs = sections[0].stations.map((s) => s.slug);
      const recentSlugs = sections[1].stations.map((s) => s.slug);
      const allSlugs = sections[2].stations.map((s) => s.slug);

      // Pinned contains outram-park and tiong-bahru
      expect(pinnedSlugs).toEqual(["outram-park", "tiong-bahru"]);

      // Recent excludes tiong-bahru because it is already pinned
      expect(recentSlugs).toEqual(["shenton-way", "harbourfront"]);
      expect(recentSlugs).not.toContain("tiong-bahru");

      // All stations excludes any station from pinned or recent
      expect(allSlugs).not.toContain("outram-park");
      expect(allSlugs).not.toContain("tiong-bahru");
      expect(allSlugs).not.toContain("shenton-way");
      expect(allSlugs).not.toContain("harbourfront");

      // Verify NO station id occurs twice across all sections
      const totalSlugs = [...pinnedSlugs, ...recentSlugs, ...allSlugs];
      expect(new Set(totalSlugs).size).toBe(totalSlugs.length);
      expect(totalSlugs.length).toBe(STATIONS.length);
    });

    it("in Frequent mode with no pins and no recent: only 'all' section is returned", () => {
      const sections = buildStationSections({
        stations: STATIONS,
        pins: [],
        recent: [],
        mode: "frequent",
      });

      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe("all");
      expect(sections[0].stations.length).toBe(STATIONS.length);

      const allSlugs = sections[0].stations.map((s) => s.slug);
      expect(new Set(allSlugs).size).toBe(allSlugs.length);
    });

    it("in A–Z mode: one flat list with no extra Pinned/Recent sections", () => {
      const sections = buildStationSections({
        stations: STATIONS,
        pins,
        recent,
        mode: "az",
      });

      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe("all");
      expect(sections[0].stations.length).toBe(STATIONS.length);

      const allSlugs = sections[0].stations.map((s) => s.slug);
      expect(new Set(allSlugs).size).toBe(allSlugs.length);
    });

    it("in Near me mode: one flat list with no extra Pinned/Recent sections", () => {
      const sections = buildStationSections({
        stations: STATIONS,
        pins,
        recent,
        mode: "near",
        nearOrder: ["shenton-way", "outram-park"],
      });

      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe("all");
      expect(sections[0].stations.length).toBe(STATIONS.length);

      const allSlugs = sections[0].stations.map((s) => s.slug);
      expect(new Set(allSlugs).size).toBe(allSlugs.length);
      expect(allSlugs[0]).toBe("shenton-way");
      expect(allSlugs[1]).toBe("outram-park");
    });

    it("in By line mode: one flat list, each station appears AT MOST ONCE", () => {
      const sections = buildStationSections({
        stations: STATIONS,
        pins,
        recent,
        mode: "line",
      });

      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe("all");
      expect(sections[0].stations.length).toBe(STATIONS.length);

      const allSlugs = sections[0].stations.map((s) => s.slug);
      // Crucial test: Interchange stations like Outram Park (EW16/NE3/TE17) appear EXACTLY ONCE
      expect(allSlugs.filter((s) => s === "outram-park")).toHaveLength(1);
      expect(allSlugs.filter((s) => s === "dhoby-ghaut")).toHaveLength(1);
      expect(allSlugs.filter((s) => s === "marina-bay")).toHaveLength(1);
      expect(new Set(allSlugs).size).toBe(allSlugs.length);
    });

    it("in Search mode: one flat list, each station once", () => {
      const sections = buildStationSections({
        stations: STATIONS,
        pins,
        recent,
        query: "outram",
      });

      expect(sections).toHaveLength(1);
      expect(sections[0].id).toBe("search");
      expect(sections[0].stations).toHaveLength(1);
      expect(sections[0].stations[0].slug).toBe("outram-park");
    });

    it("guarantees no station occurs twice across any permutations of mode, pins, recent, query", () => {
      const testModes = ["frequent", "near", "az", "line"] as const;
      const testPins = [[], ["outram-park"], ["outram-park", "tiong-bahru"]];
      const testRecent = [[], ["outram-park"], ["tiong-bahru", "shenton-way"]];
      const testQueries = ["", "park", "nonexistentstation"];

      for (const mode of testModes) {
        for (const p of testPins) {
          for (const r of testRecent) {
            for (const q of testQueries) {
              const result = buildStationSections({
                stations: STATIONS,
                pins: p,
                recent: r,
                mode,
                query: q,
              });

              const allIds = result.flatMap((s) => s.stations.map((st) => st.slug));
              expect(new Set(allIds).size).toBe(allIds.length);
            }
          }
        }
      }
    });
  });

  describe("orderStationPlatforms pure function", () => {
    const mockPlatforms = [
      {
        code: "EW16",
        line: "EW",
        directions: [
          { key: "TO_WEST", terminal: "Tuas Link" },
          { key: "TO_EAST", terminal: "Pasir Ris" },
          { key: "TO_WEST", terminal: "Tuas Link" }, // Duplicate to test deduplication
        ],
      },
      {
        code: "NE3",
        line: "NE",
        directions: [
          { key: "TO_NORTH", terminal: "Punggol" },
          { key: "TO_SOUTH", terminal: "HarbourFront" },
        ],
      },
      {
        code: "TE17",
        line: "TE",
        directions: [
          { key: "TO_NORTH", terminal: "Woodlands North" },
          { key: "TO_SOUTH", terminal: "Bayshore" },
        ],
      },
    ];

    it("deduplicates directions so every line/direction shows once", () => {
      const ordered = orderStationPlatforms(mockPlatforms, "outram-park");
      const ew = ordered.find((p) => p.line === "EW");
      expect(ew?.directions).toHaveLength(2);
      expect(ew?.directions.map((d) => d.key)).toEqual(
        expect.arrayContaining(["TO_EAST", "TO_WEST"])
      );
    });

    it("for Outram Park in morning (09:00 SGT): EWL (towards Pasir Ris) and TEL (towards Bayshore) are first, NEL is last", () => {
      // 09:00 SGT = 01:00 UTC
      const morningTime = new Date("2026-11-19T01:00:00Z").getTime();
      const ordered = orderStationPlatforms(mockPlatforms, "outram-park", morningTime);

      // NEL is collapsed/last
      expect(ordered[2].line).toBe("NE");
      expect(ordered[0].line).toBe("EW");
      expect(ordered[1].line).toBe("TE");

      // Commute directions are first on EWL and TEL
      expect(ordered[0].directions[0].terminal).toBe("Pasir Ris");
      expect(ordered[1].directions[0].terminal).toBe("Bayshore");
    });

    it("for Outram Park in evening (18:00 SGT): TEL (towards Woodlands North) and EWL (towards Tuas Link) are first, NEL is last", () => {
      // 18:00 SGT = 10:00 UTC
      const eveningTime = new Date("2026-11-19T10:00:00Z").getTime();
      const ordered = orderStationPlatforms(mockPlatforms, "outram-park", eveningTime);

      // NEL is collapsed/last
      expect(ordered[2].line).toBe("NE");
      expect(ordered[0].line).toBe("TE");
      expect(ordered[1].line).toBe("EW");

      // Commute directions are first on TEL and EWL
      expect(ordered[0].directions[0].terminal).toBe("Woodlands North");
      expect(ordered[1].directions[0].terminal).toBe("Tuas Link");
    });

    it("for Tiong Bahru: Pasir Ris first in morning, Tuas Link first in evening", () => {
      const tbPlatform = [
        {
          code: "EW17",
          line: "EW",
          directions: [
            { key: "TO_WEST", terminal: "Tuas Link" },
            { key: "TO_EAST", terminal: "Pasir Ris" },
          ],
        },
      ];

      const morning = orderStationPlatforms(tbPlatform, "tiong-bahru", new Date("2026-11-19T01:00:00Z").getTime());
      expect(morning[0].directions[0].terminal).toBe("Pasir Ris");

      const evening = orderStationPlatforms(tbPlatform, "tiong-bahru", new Date("2026-11-19T10:00:00Z").getTime());
      expect(evening[0].directions[0].terminal).toBe("Tuas Link");
    });

    it("for Shenton Way: Woodlands North first in evening", () => {
      const swPlatform = [
        {
          code: "TE19",
          line: "TE",
          directions: [
            { key: "TO_SOUTH", terminal: "Bayshore" },
            { key: "TO_NORTH", terminal: "Woodlands North" },
          ],
        },
      ];

      const evening = orderStationPlatforms(swPlatform, "shenton-way", new Date("2026-11-19T10:00:00Z").getTime());
      expect(evening[0].directions[0].terminal).toBe("Woodlands North");
    });
  });
});
