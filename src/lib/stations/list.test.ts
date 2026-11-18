import { describe, expect, it } from "vitest";
import { STATIONS } from "@/lib/network";
import {
  filterStations,
  getLineGroups,
  sortAlphabetical,
  sortFrequent,
  sortNearby,
} from "./list";

describe("Stations list helpers", () => {
  const sampleStations = STATIONS.filter((s) =>
    ["outram-park", "tiong-bahru", "shenton-way", "orchard"].includes(s.slug)
  );

  it("filters stations by English name, Chinese name, code, or slug", () => {
    // English name
    const en = filterStations(sampleStations, "outram");
    expect(en.map((s) => s.slug)).toEqual(["outram-park"]);

    // Chinese name
    const zh = filterStations(sampleStations, "歐南園");
    expect(zh.map((s) => s.slug)).toEqual(["outram-park"]);

    // Code prefix
    const code = filterStations(sampleStations, "te17");
    expect(code.map((s) => s.slug)).toEqual(["outram-park"]);

    // Partial code prefix
    const codePartial = filterStations(sampleStations, "ew");
    expect(codePartial.length).toBeGreaterThanOrEqual(2);

    // Empty query returns all
    expect(filterStations(sampleStations, "")).toHaveLength(sampleStations.length);
  });

  it("sorts alphabetical for en and zh-Hant", () => {
    const enSorted = sortAlphabetical(sampleStations, "en");
    expect(enSorted[0].name.en.toLowerCase().startsWith("o")).toBe(true);

    const zhSorted = sortAlphabetical(sampleStations, "zh-Hant");
    expect(zhSorted.length).toBe(sampleStations.length);
  });

  it("sorts frequent stations first, then falls back to A-Z", () => {
    // Empty frequent slugs falls back to alphabetical
    const fallback = sortFrequent(sampleStations, [], "en");
    const alpha = sortAlphabetical(sampleStations, "en");
    expect(fallback.map((s) => s.slug)).toEqual(alpha.map((s) => s.slug));

    // Shenton Way ranked first
    const ranked = sortFrequent(sampleStations, ["shenton-way", "outram-park"], "en");
    expect(ranked[0].slug).toBe("shenton-way");
    expect(ranked[1].slug).toBe("outram-park");
  });

  it("sorts nearby stations based on GPS distance order", () => {
    const near = sortNearby(sampleStations, ["tiong-bahru", "orchard"], "en");
    expect(near[0].slug).toBe("tiong-bahru");
    expect(near[1].slug).toBe("orchard");
  });

  it("groups stations by line", () => {
    const groups = getLineGroups();
    expect(groups.length).toBe(6);
    expect(groups.map((g) => g.code)).toEqual(["NSL", "EWL", "NEL", "CCL", "DTL", "TEL"]);

    const ewGroup = groups.find((g) => g.code === "EWL");
    expect(ewGroup?.stations.length).toBeGreaterThan(10);
    expect(ewGroup?.stations.some((s) => s.slug === "outram-park")).toBe(true);
  });
});
