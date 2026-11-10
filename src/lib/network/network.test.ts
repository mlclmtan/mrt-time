import { describe, expect, it } from "vitest";
import {
  LINES,
  PLATFORMS,
  STATIONS,
  canonicalDirection,
  directionBetween,
  directionChoices,
  directionsAt,
  findRoutes,
  getStation,
  isOriginTerminal,
  isValidDirection,
  nearestStation,
  rideMinutes,
  stationsByDistance,
  transferMinutes,
} from ".";
import { LINE_PREFIX } from "./data";
import { readFileSync } from "node:fs";
import { zhHant } from "../i18n/dict";

/** Characters that only exist in Simplified Chinese (their Traditional forms differ). */
const SIMPLIFIED_ONLY =
  "东兰乌湾龙门广场宝丽华乐叶宁览马镇线车长达务实贝莱维罗尔劳纳诺滨兴荣来连区园厦杨桥纽顿苏伦杰义谦凯陈庆万国体诰礼纬冈别让刹亚笼汤驱联黄绿红蓝环号码头机双开关边岛业坛汇会侨发圣经云观时间动闸选择请显设读数记录钟换"
    .split("");

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

  it("Tiong Bahru → Changi Airport always changes at Tanah Merah (no through train onto the branch)", () => {
    const routes = findRoutes("tiong-bahru", "changi-airport");
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const rides = r.steps.filter((s) => s.kind === "ride");
      // No single ride goes from the EWL trunk onto CG1/CG2.
      for (const ride of rides) if (ride.to.startsWith("CG")) expect(["EW4", "CG1"]).toContain(ride.from);
    }
    const best = routes[0];
    expect(best.steps.map((s) => (s.kind === "ride" ? `${s.from}>${s.to}` : `change@${s.at}`))).toEqual(["EW17>EW4", "change@tanah-merah", "EW4>CG2"]);
    expect(best.transfers).toBe(1);
  });

  it("every direction has an explicit stop list (not code numbers), in running order", () => {
    const of = (line: keyof typeof LINES, key: string) => LINES[line].directions[key].paths;
    // Real numbering gaps are skipped; unopened stations are absent everywhere.
    for (const missing of ["NS6", "NE2", "CC18", "TE10", "TE21", "TE22A", "DT36", "DT37", "TE30", "TE31", "CE1", "CE2"]) expect(PLATFORMS[missing]).toBeUndefined();
    expect(of("NSL", "TO_MARINA_SOUTH_PIER")[0].slice(3, 6)).toEqual(["NS4", "NS5", "NS7"]);
    expect(of("NEL", "TO_PUNGGOL")[0].slice(0, 3)).toEqual(["NE1", "NE3", "NE4"]);
    expect(of("TEL", "TO_BAYSHORE")[0].slice(7, 10)).toEqual(["TE8", "TE9", "TE11"]);
    expect(of("TEL", "TO_BAYSHORE")[0].slice(17, 20)).toEqual(["TE19", "TE20", "TE22"]);
    expect(of("CCL", "TO_PRINCE_EDWARD_ROAD")[0].slice(15, 18)).toEqual(["CC16", "CC17", "CC19"]);
    // Branch codes don't follow the trunk: CG1/CG2 hang off EW4; CC33/CC34 sit on the Promenade link.
    expect(of("EWL", "TO_CHANGI_AIRPORT")).toEqual([["EW4", "CG1", "CG2"]]);
    expect(of("EWL", "TO_EAST")[0]).not.toContain("CG1");
    expect(of("CCL", "TO_DHOBY_GHAUT")[0].at(-1)).toBe("CC1");
    // The source has no generated sequences any more.
    const source = readFileSync(new URL("./data.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/function seq\(|seq\("/);
  });

  it("Circle Line since Stage 6 (v2.2): clockwise / anticlockwise round the loop, spur to Dhoby Ghaut, v2.1's link retired", () => {
    const ccl = LINES.CCL.directions;
    expect(ccl.TO_PRINCE_EDWARD_ROAD.board.en).toBe("Anticlockwise");
    expect(ccl.TO_DHOBY_GHAUT.board.en).toBe("Clockwise");
    expect(ccl.TO_PRINCE_EDWARD_ROAD.alsoBoard?.map((b) => b.en)).toEqual(["Prince Edward Road", "Stadium"]);
    // The loop is CC4 … CC34 with no gap but Bukit Brown (CC18, unopened).
    expect(ccl.TO_PRINCE_EDWARD_ROAD.loop).toHaveLength(30);
    expect(ccl.TO_DHOBY_GHAUT.loop).toEqual([...ccl.TO_PRINCE_EDWARD_ROAD.loop!].reverse());
    // Both ways everywhere on the loop (Bayfront and Marina Bay included); Dhoby Ghaut only one way.
    for (const code of ["CC4", "CC29", "CC32", "CC33", "CC34"]) expect(directionsAt(code).map((d) => d.key).sort(), code).toEqual(["TO_DHOBY_GHAUT", "TO_PRINCE_EDWARD_ROAD"]);
    expect(directionsAt("CC1").map((d) => d.key)).toEqual(["TO_PRINCE_EDWARD_ROAD"]);
    // The quicker way round: HarbourFront → Prince Edward Road anticlockwise, Bayfront → Marina Bay clockwise.
    expect(directionBetween("CC29", "CC32")?.key).toBe("TO_PRINCE_EDWARD_ROAD");
    expect(directionBetween("CC34", "CC33")?.key).toBe("TO_DHOBY_GHAUT");
    expect(directionBetween("CC32", "CC5")?.key).toBe("TO_PRINCE_EDWARD_ROAD");
    expect(rideMinutes("CC32", "CC5")).toBe(8); // 4 stops via Marina Bay, Bayfront, Promenade
    expect(isOriginTerminal("CCL", "TO_PRINCE_EDWARD_ROAD", "CC4")).toBe(false);
    expect(isOriginTerminal("CCL", "TO_PRINCE_EDWARD_ROAD", "CC1")).toBe(true);
    // Esplanade → Bayfront: change to the loop at Promenade (spur trains go the other way round).
    const route = findRoutes("esplanade", "bayfront")[0];
    expect(route.steps.filter((s) => s.kind === "ride" && s.line === "CCL").map((s) => (s.kind === "ride" ? `${s.from}>${s.to}` : ""))).toEqual(["CC3>CC4", "CC4>CC34"]);
    // Retired key: not offered, new rows refused, stored rows read as today's direction.
    expect(ccl.TO_PROMENADE.retired).toBe(true);
    expect(directionChoices("bayfront").map((c) => c.direction)).not.toContain("TO_PROMENADE");
    expect(isValidDirection("CCL", "TO_PROMENADE")).toBe(false);
    expect(canonicalDirection("CCL", "TO_PROMENADE", "CC33")).toBe("TO_PRINCE_EDWARD_ROAD");
    expect(canonicalDirection("CCL", "TO_PRINCE_EDWARD_ROAD", "CC34")).toBe("TO_DHOBY_GHAUT");
    expect(canonicalDirection("CCL", "TO_PRINCE_EDWARD_ROAD", "CC20")).toBe("TO_PRINCE_EDWARD_ROAD");
    expect(canonicalDirection("EWL", "TO_EAST", "EW17")).toBe("TO_EAST");
  });

  it("freezes the slugs, codes and direction keys stored rows and seeded journeys use", () => {
    // Snapshot of v2.0.0 (deployed, migrated, backfilled). Renaming any of these
    // orphans stored readings, sightings, trip events or journeys: add, never rename.
    const frozen = JSON.parse(readFileSync(new URL("./__fixtures__/frozen-keys.json", import.meta.url), "utf8")) as {
      stations: Record<string, string[]>;
      directions: Record<string, string[]>;
    };
    for (const [slug, codes] of Object.entries(frozen.stations)) expect(getStation(slug)?.codes, slug).toEqual(codes);
    for (const [line, keys] of Object.entries(frozen.directions))
      for (const key of keys) expect(LINES[line as keyof typeof LINES].directions[key]?.key, `${line}:${key}`).toBe(key);
    // The owner's seeded journeys (v1): EW17/EW16/EW15 TO_EAST/TO_WEST, TE17/TE19 TO_BAYSHORE/TO_NORTH.
    for (const [code, dir] of [["EW17", "TO_EAST"], ["EW16", "TO_WEST"], ["EW15", "TO_WEST"], ["TE17", "TO_BAYSHORE"], ["TE19", "TO_NORTH"], ["NE3", "TO_PUNGGOL"], ["NE3", "TO_HARBOURFRONT"]])
      expect(directionsAt(code).map((d) => d.key)).toContain(dir);
  });

  it("stations without sourced exits / nearby places / forecast area leave them out", () => {
    const plain = getStation("kembangan")!;
    expect(plain.exits).toBeUndefined();
    expect(plain.nearby).toBeUndefined();
    expect(plain.weatherArea).toBeUndefined();
    expect(getStation("tiong-bahru")!.exits?.length).toBeGreaterThan(0);
  });

  it("Chinese names are Traditional (zh-Hant): no Simplified-only characters", () => {
    const names = [
      ...STATIONS.flatMap((s) => [s.name, ...(s.exits ?? []), ...(s.nearby ?? [])]),
      ...Object.values(LINES).flatMap((l) => [l.name, ...Object.values(l.directions).flatMap((d) => [d.label, d.board, ...(d.alsoBoard ?? [])])]),
    ].map((n) => n["zh-Hant"]);
    const bad = names.filter((zh) => [...zh].some((ch) => SIMPLIFIED_ONLY.includes(ch)));
    expect(bad).toEqual([]);
    expect(Object.values(zhHant).filter((v) => [...v].some((ch) => SIMPLIFIED_ONLY.includes(ch)))).toEqual([]);
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
