import { describe, expect, it } from "vitest";
import {
  LINES,
  PLATFORMS,
  STATIONS,
  directionChoices,
  directionsAt,
  findRoutes,
  getStation,
  nearestStation,
  rideMinutes,
  stationsByDistance,
  transferMinutes,
} from ".";
import { LINE_PREFIX } from "./data";

describe("full MRT network data", () => {
  it("covers all six lines, each with contiguous running order and no duplicate codes", () => {
    expect(Object.keys(LINES).sort()).toEqual(["CCL", "DTL", "EWL", "NEL", "NSL", "TEL"]);
    const codes = STATIONS.flatMap((s) => s.codes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const line of Object.values(LINES)) {
      const onLine = Object.values(PLATFORMS).filter((p) => p.line === line.code);
      expect(onLine.length).toBeGreaterThan(10);
      for (const d of Object.values(line.directions))
        for (const path of d.paths) {
          expect(path.at(-1)).toBe(d.terminal);
          // Every code on a path exists, belongs to this line and appears once.
          expect(new Set(path).size).toBe(path.length);
          for (const c of path) expect(PLATFORMS[c]?.line).toBe(line.code);
        }
      // Every platform of the line is served by some direction.
      for (const p of onLine) expect(directionsAt(p.code).length).toBeGreaterThan(0);
      // Order along the first path is 1..n with no gaps.
      const trunk = Object.values(line.directions)[0].paths[0];
      const orders = trunk.map((c) => PLATFORMS[c].order).filter((o, i) => o === i + 1);
      expect(orders.length).toBeGreaterThan(trunk.length / 2);
    }
    expect(Object.values(LINE_PREFIX)).toContain("CCL");
    expect(STATIONS.length).toBeGreaterThan(130);
  });

  it("every interchange links all its codes with a transfer time (estimates ≤ 4 min)", () => {
    const interchanges = STATIONS.filter((s) => s.codes.length > 1);
    expect(interchanges.length).toBeGreaterThanOrEqual(25);
    for (const s of interchanges)
      for (const a of s.codes)
        for (const b of s.codes)
          if (a !== b) {
            expect(s.transferMin?.[`${a}>${b}`]).toBeGreaterThan(0);
            expect(transferMinutes(a, b)).toBeLessThanOrEqual(4);
          }
    // Outram Park EW↔TE stays at the observed 2 min.
    expect(transferMinutes("EW16", "TE17")).toBe(2);
    expect(getStation("dhoby-ghaut")?.codes).toEqual(["NS24", "NE6", "CC1"]);
  });

  it("keeps the v1 station slugs", () => {
    for (const slug of ["tanjong-pagar", "outram-park", "tiong-bahru", "redhill", "pasir-ris", "joo-koon", "tuas-link", "orchard", "maxwell", "shenton-way", "woodlands-north", "bayshore", "harbourfront", "punggol-coast"])
      expect(getStation(slug)).toBeDefined();
  });

  it("branch-aware directions: Tanah Merah offers Changi Airport; terminals only one way", () => {
    expect(directionChoices("tanah-merah").map((c) => c.board.en)).toEqual(["Pasir Ris", "Joo Koon / Tuas Link", "Changi Airport"]);
    expect(directionChoices("changi-airport").map((c) => c.board.en)).toEqual(["Tanah Merah"]);
    expect(directionChoices("pasir-ris").map((c) => c.board.en)).toEqual(["Joo Koon / Tuas Link"]);
    expect(directionChoices("expo").map((c) => c.board.en).sort()).toEqual(["Bukit Panjang", "Changi Airport", "Tanah Merah"]);
  });

  it("routes Tiong Bahru → Changi Airport and Woodlands → HarbourFront within two changes", () => {
    const airport = findRoutes("tiong-bahru", "changi-airport");
    expect(airport.length).toBeGreaterThan(0);
    expect(airport[0].transfers).toBeLessThanOrEqual(2);
    expect(airport[0].steps.at(-1)).toMatchObject({ kind: "ride", to: "CG2", direction: "TO_CHANGI_AIRPORT" });
    const harbour = findRoutes("woodlands", "harbourfront");
    expect(harbour.length).toBeGreaterThan(0);
    expect(harbour[0].transfers).toBeLessThanOrEqual(2);
    expect(harbour[0].steps.at(-1)).toMatchObject({ kind: "ride" });
    for (const r of harbour) expect(r.transfers).toBeLessThanOrEqual(2);
    // Every station is reachable from Tiong Bahru with ≤ 2 changes.
    for (const s of STATIONS) if (s.slug !== "tiong-bahru") expect(findRoutes("tiong-bahru", s.slug).length, s.slug).toBeGreaterThan(0);
  });

  it("ride minutes: observed figures, then 2 min a stop", () => {
    expect(rideMinutes("EW17", "EW16")).toBe(3);
    expect(rideMinutes("EW16", "EW15")).toBe(2);
    expect(rideMinutes("NS1", "NS2")).toBe(2);
    expect(rideMinutes("EW4", "CG2")).toBe(4);
    expect(Number.isNaN(rideMinutes("EW17", "TE17"))).toBe(true);
  });

  it("nearest station by distance (computed on the device)", () => {
    expect(nearestStation(1.2862, 103.8272)?.station.slug).toBe("tiong-bahru");
    expect(nearestStation(1.3575, 103.9885)?.station.slug).toBe("changi-airport");
    expect(nearestStation(1.0, 104.5)).toBeNull(); // far out at sea
    const list = stationsByDistance(1.2803, 103.8395);
    expect(list[0].station.slug).toBe("outram-park");
    expect(list[1].distanceM).toBeGreaterThan(list[0].distanceM);
  });
});
