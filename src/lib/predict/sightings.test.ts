import { describe, expect, it } from "vitest";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import { predict, type Observation } from "./index";
import {
  corroboratedSightings,
  dedupeTrains,
  knownTrainsAt,
  linkRides,
  propagate,
  propagationError,
  readingSightings,
  sameTrain,
  shortTurnStop,
  sightingError,
  tapError,
  trainAt,
  unusableSighting,
  type TrainSighting,
} from "./sightings";
import { trainOffset } from "../network";
import { directionView } from "./board-view";

// Synthetic fixtures only. 2026-11-10 is a Tuesday.
const TUE = "2026-11-10";
const at = (clock: string, date = TUE) => sgtInstant(date, clock);
const boarded = (station: string, line: string, direction: string, clock: string, extra: Partial<TrainSighting> = {}): TrainSighting => ({
  station,
  line,
  direction,
  at: at(clock),
  kind: "boarded",
  source: "owner",
  status: "approved",
  ...extra,
});

describe("propagation along the line (error model)", () => {
  it("a 10:14 boarding at Tiong Bahru (EW17) towards Pasir Ris: Outram Park 10:17, Tanjong Pagar 10:19, each with its error", () => {
    const s = boarded("EW17", "EWL", "TO_EAST", "10:14");
    const outram = trainAt(s, "EW16")!;
    expect(sgtClock(outram.at)).toBe("10:17");
    // Tap at Now ±0.5 + one measured hop (EW17→EW16 observed) 0.1.
    expect(outram).toMatchObject({ hops: 1, errMin: 0.6, spreadMin: 0, origin: "EW17", kind: "boarded" });
    const tp = trainAt(s, "EW15")!;
    expect(sgtClock(tp.at)).toBe("10:19"); // EW15↔EW17 observed 5 min: a measured ride
    expect(tp.errMin).toBe(0.7);
    // Backwards: it left Redhill (EW18) 2 min earlier; that hop is a default (+0.3).
    const redhill = trainAt(s, "EW18")!;
    expect(sgtClock(redhill.at)).toBe("10:12");
    expect(redhill).toMatchObject({ hops: 1, errMin: 0.8 });
  });

  it("stores an error on every sighting: Now ±0.5, chosen time / next train on a board ±1, later board trains ±1.5", () => {
    expect(sightingError({ kind: "boarded", at: at("10:14"), recordedAt: at("10:14") + 5_000 })).toBe(0.5);
    expect(sightingError({ kind: "boarded", at: at("10:14"), recordedAt: at("10:19") })).toBe(1); // moved back with the chips
    expect(sightingError({ kind: "alighted", at: at("10:14"), errMin: 1 })).toBe(1);
    expect(tapError(false)).toBe(0.5);
    expect(tapError(true)).toBe(1);
    const reading = readingSightings({ id: 9, station: "EW16", line: "EWL", direction: "TO_EAST", capturedAt: at("10:15"), minutes: [2, 7, 12], source: "owner", status: "approved" });
    expect(reading.map((r) => r.errMin)).toEqual([1, 1.5, 1.5]);
  });

  it("adds 0.3 min a stop (0.1 on measured rides) and stops once the error passes 1.5 min", () => {
    const s = boarded("EW25", "EWL", "TO_EAST", "10:00"); // no observed rides around Chinese Garden
    expect(propagate(s, ["EW25", "EW24", "EW23", "EW22", "EW21"]).map((t) => [t.station, t.errMin])).toEqual([
      ["EW25", 0.5],
      ["EW24", 0.8],
      ["EW23", 1.1],
      ["EW22", 1.4],
    ]);
    expect(propagationError(["EW17", "EW16"])).toBe(0.1);
    expect(propagationError(["EW25", "EW24", "EW23"])).toBe(0.6);
    // The board's next train (±1) reaches one stop; its later trains (±1.5) stay at their platform.
    const [next, later] = readingSightings({ station: "EW25", line: "EWL", direction: "TO_EAST", capturedAt: at("10:00"), minutes: [2, 6], source: "owner", status: "approved" });
    expect(trainAt(next, "EW24")?.errMin).toBe(1.3);
    expect(trainAt(next, "EW23")).toBeNull();
    expect(trainAt(later, "EW25")?.errMin).toBe(1.5);
    expect(trainAt(later, "EW24")).toBeNull();
    // Long measured rides still add up: TE17 → Woodlands (15 stops, 37 min) is too far for a tap.
    const north = boarded("TE17", "TEL", "TO_NORTH", "08:00");
    expect(trainAt(north, "TE2")).toBeNull();
    expect(trainOffset("TEL", "TO_NORTH", "TE17", "TE2")?.minutes).toBeCloseTo(37, 6);
    expect(sgtClock(trainAt(boarded("TE17", "TEL", "TO_BAYSHORE", "10:17"), "TE19")!.at)).toBe("10:20");
  });

  it("never crosses to the other direction or another line; boardings at a terminal are skipped (trains wait there)", () => {
    const s = boarded("EW17", "EWL", "TO_EAST", "10:14");
    expect(trainAt(s, "TE17")).toBeNull();
    expect(trainAt(s, "CG2")).toBeNull();
    // Tuas Link is where TO_EAST trains start: a boarding there doesn't time the train, even here.
    const atStart = boarded("EW33", "EWL", "TO_EAST", "10:00");
    expect(unusableSighting(atStart)).toBe(true);
    expect(trainAt(atStart, "EW33")).toBeNull();
    expect(knownTrainsAt({ station: "EW33", line: "EWL", direction: "TO_EAST" }, [atStart])).toEqual([]);
    // Getting off at the end of the line is fine.
    expect(trainAt({ ...boarded("EW1", "EWL", "TO_EAST", "10:00"), kind: "alighted" }, "EW1")).not.toBeNull();
  });

  it("stops at the first short-turn terminal (Joo Koon, Springleaf) unless the board named the destination", () => {
    const west = boarded("EW28", "EWL", "TO_WEST", "10:00");
    expect(trainAt(west, "EW29")).not.toBeNull();
    expect(trainAt(west, "EW30")).toBeNull(); // the train may end at Joo Koon
    expect(trainAt({ ...west, destination: "Tuas Link" }, "EW30")).not.toBeNull();
    const north = boarded("TE5", "TEL", "TO_NORTH", "09:00");
    expect(trainAt(north, "TE4")).not.toBeNull();
    expect(trainAt(north, "TE3")).toBeNull();
    expect(trainAt({ ...north, destination: "Woodlands North" }, "TE3")).not.toBeNull();
    expect(shortTurnStop("TEL", "TO_NORTH", "TE5", "Springleaf")).toBe("TE4");
    expect(shortTurnStop("TEL", "TO_NORTH", "TE3", null)).toBeNull(); // already past it
    // Upstream (earlier) stops are always fine.
    expect(trainAt(north, "TE6")).not.toBeNull();
  });

  it("branches: a Changi Airport train is only on the branch", () => {
    const branch = boarded("CG1", "EWL", "TO_CHANGI_AIRPORT", "12:00");
    expect(trainAt(branch, "CG2")).not.toBeNull();
    expect(trainAt(branch, "EW4")!.at).toBeLessThan(branch.at);
    expect(trainAt(branch, "EW3")).toBeNull();
  });

  it("Circle Line (v2.2 loop): loop trains run round past Bayfront → Promenade; spur trains make the merge unknown", () => {
    // Anticlockwise (TO_PRINCE_EDWARD_ROAD key): Marina Bay → Bayfront → Promenade → Nicoll Highway, round the loop.
    const loop = boarded("CC33", "CCL", "TO_PRINCE_EDWARD_ROAD", "10:00");
    expect(trainAt(loop, "CC34")).not.toBeNull();
    expect(trainAt(loop, "CC4")).not.toBeNull();
    expect(trainAt(loop, "CC5")!.at).toBeGreaterThan(trainAt(loop, "CC4")!.at);
    expect(trainOffset("CCL", "TO_PRINCE_EDWARD_ROAD", "CC33", "CC5")).toMatchObject({ hops: 3, between: ["CC33", "CC34", "CC4", "CC5"] });
    // …and earlier it passed Prince Edward Road (the nearer way round is upstream).
    expect(trainAt(loop, "CC32")!.at).toBeLessThan(loop.at);
    // Clockwise (TO_DHOBY_GHAUT key) runs the other way: Bayfront → Marina Bay → Prince Edward Road.
    const cw = boarded("CC34", "CCL", "TO_DHOBY_GHAUT", "10:00");
    expect(trainAt(cw, "CC33")!.at).toBeGreaterThan(cw.at);
    expect(trainAt(cw, "CC4")!.at).toBeLessThan(cw.at);
    // At Nicoll Highway a train may have come from the spur (Esplanade) or the loop (Bayfront): upstream past Promenade is unknown.
    const merged = boarded("CC5", "CCL", "TO_PRINCE_EDWARD_ROAD", "10:00");
    expect(trainAt(merged, "CC4")).not.toBeNull();
    expect(trainAt(merged, "CC34")).toBeNull();
    // Past Stadium only when the screen said it isn't the off-peak shuttle ("ends at Stadium").
    expect(trainAt(merged, "CC6")).not.toBeNull();
    expect(trainAt(merged, "CC7")).toBeNull();
    expect(trainAt({ ...merged, destination: "Anticlockwise" }, "CC7")).not.toBeNull();
    expect(shortTurnStop("CCL", "TO_PRINCE_EDWARD_ROAD", "CC5", "Stadium")).toBe("CC6");
    expect(shortTurnStop("CCL", "TO_PRINCE_EDWARD_ROAD", "CC5", "Prince Edward Road")).toBe("CC32");
  });

  it("pauses propagation (disruption) and uses learned ride times when given", () => {
    const s = boarded("EW25", "EWL", "TO_EAST", "10:00");
    expect(trainAt(s, "EW24", { propagate: false })).toBeNull();
    expect(trainAt(s, "EW25", { propagate: false })).not.toBeNull();
    const rides = { "EW25>EW24": 3.5 };
    const t = trainAt(s, "EW24", { rides })!;
    expect((t.at - s.at) / MINUTE).toBe(3.5);
    expect(t.errMin).toBe(0.6); // a measured hop
  });
});

describe("same train seen twice: merge (never average)", () => {
  const target = { station: "EW16", line: "EWL", direction: "TO_EAST" };
  it("keeps the lowest-error evidence; a board reading's train near a tap is that train", () => {
    const here = boarded("EW16", "EWL", "TO_EAST", "10:17");
    const far = boarded("EW17", "EWL", "TO_EAST", "10:14");
    const reading = readingSightings({ id: 3, station: "EW16", line: "EWL", direction: "TO_EAST", capturedAt: at("10:15"), minutes: [2, 7], source: "owner", status: "approved" });
    const trains = knownTrainsAt(target, [far, here, ...reading]);
    expect(trains.map((t) => sgtClock(t.at))).toEqual(["10:17", "10:22"]);
    expect(trains[0]).toMatchObject({ kind: "boarded", hops: 0, errMin: 0.5 });
    expect(dedupeTrains([])).toEqual([]);
    // Pending sightings are ignored.
    expect(knownTrainsAt(target, [{ ...here, status: "pending" }])).toEqual([]);
  });

  it("a boarding and its getting off are one train, even when the times disagree by 2 min", () => {
    const ride = linkRides([
      boarded("EW17", "EWL", "TO_EAST", "10:14", { id: 1, userId: "u" }),
      boarded("EW16", "EWL", "TO_EAST", "10:19", { id: 2, userId: "u", kind: "alighted" }), // 2 min slower than expected
    ]);
    expect(ride[0].ref).toBe("ride:1");
    expect(ride[1].ref).toBe("ride:1");
    expect(knownTrainsAt({ station: "EW15", line: "EWL", direction: "TO_EAST" }, ride)).toHaveLength(1);
    // Without the link they would be two trains 2 min apart off-peak.
    const unlinked = ride.map((s) => ({ ...s, ref: null }));
    expect(knownTrainsAt({ station: "EW15", line: "EWL", direction: "TO_EAST" }, unlinked)).toHaveLength(2);
  });

  it("two trains under half the shortest gap apart are one; further apart they are two", () => {
    const a = { ...trainAt(boarded("EW16", "EWL", "TO_EAST", "11:00"), "EW16")!, ref: "a" };
    const b = { ...a, ref: "b", at: a.at + 1.2 * MINUTE };
    expect(sameTrain(a, b)).toBe(true); // 1.2 < max(1.5, 1.0) and < 2.5
    expect(sameTrain(a, { ...b, at: a.at + 1.6 * MINUTE })).toBe(false);
    // Weekday peak: shortest gap 2 min → under 1 min only.
    const p = { ...a, at: at("08:00") };
    expect(sameTrain(p, { ...p, ref: "b", at: p.at + 1.2 * MINUTE })).toBe(false);
  });

  it("public sightings count only at their own platform and never outrank the owner's", () => {
    const owner = boarded("EW16", "EWL", "TO_EAST", "10:17");
    const pub = boarded("EW16", "EWL", "TO_EAST", "10:18", { source: "public", ipHash: "net-a", id: 50 });
    const here = knownTrainsAt(target, [owner, pub]);
    expect(here).toHaveLength(1);
    expect(here[0].source).toBe("owner");
    expect(sgtClock(here[0].at)).toBe("10:17");
    // Alone, it's a train here but nowhere else on the line.
    expect(knownTrainsAt(target, [pub])).toHaveLength(1);
    expect(knownTrainsAt({ station: "EW15", line: "EWL", direction: "TO_EAST" }, [pub])).toEqual([]);
  });

  it("public sightings propagate once two different networks agree within 1 min", () => {
    const a = boarded("EW16", "EWL", "TO_EAST", "10:18", { source: "public", ipHash: "net-a", id: 51 });
    const sameNet = boarded("EW16", "EWL", "TO_EAST", "10:18", { source: "public", ipHash: "net-a", id: 52 });
    const other = { ...boarded("EW16", "EWL", "TO_EAST", "10:18", { source: "public", ipHash: "net-b", id: 53 }), at: a.at + 30_000 };
    expect(corroboratedSightings([a, sameNet]).size).toBe(0);
    const agreed = [a, other];
    expect(corroboratedSightings(agreed).size).toBe(2);
    expect(knownTrainsAt({ station: "EW15", line: "EWL", direction: "TO_EAST" }, agreed)).toHaveLength(1);
    // Even while awaiting review.
    const pending = [{ ...a, status: "pending" as const }, { ...other, status: "pending" as const }];
    expect(knownTrainsAt({ station: "EW15", line: "EWL", direction: "TO_EAST" }, pending)).toHaveLength(1);
  });
});

describe("predictions use propagated sightings as same-day anchors", () => {
  it("the 10:14 Tiong Bahru boarding gives exact Outram Park times from 10:17", () => {
    const sightings = [boarded("EW17", "EWL", "TO_EAST", "10:14")];
    const p = predict({ line: "EWL", direction: "TO_EAST", station: "EW16", now: at("10:15"), observations: [], sightings });
    expect(p.basis).toBe("same_day");
    expect(sgtClock(p.arrivals[0].at)).toBe("10:17");
    expect(p.reason).toMatchObject({ code: "seen_elsewhere", params: { station: "EW17", hops: 1 } });
    expect(p.confidence).toBe("high");
    const view = directionView(p, at("10:15"), "EWL");
    expect(view.state).toBe("exact");
  });

  it("a sighting 3 stops away gives an estimate with a ± band", () => {
    // EW20 → EW17: three default hops, 0.5 + 0.9 = ±1.4 → "≈ ±2".
    const sightings = [boarded("EW20", "EWL", "TO_EAST", "11:40")];
    const now = at("11:41");
    const p = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now, observations: [], sightings });
    expect(p.basis).toBe("same_day");
    expect(p.arrivals[0].errMin).toBe(1.4);
    expect(p.spreadMin).toBe(2);
    expect(p.confidence).toBe("medium");
    const view = directionView(p, now, "EWL");
    expect(view.state).toBe("estimate");
    if (view.state !== "closed") expect(view.arrivals[0].plusMinus).toBe(2);
    // Too far (EW20 → EW15, 5 stops): not used at all.
    expect(predict({ line: "EWL", direction: "TO_EAST", station: "EW15", now, observations: [], sightings }).basis).not.toBe("same_day"); // 5 stops: ±1.8
  });

  it("one tap: exact only within 2 gaps, then ≈ with a widening ±, then a range", () => {
    const sightings = [boarded("EW17", "EWL", "TO_EAST", "11:00")]; // weekday off-peak, usual gap 6 min
    const fresh = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now: at("11:01"), observations: [], sightings });
    // Stepping by the gap: ±0.5 + 0.5 = ±1 for 1–2 gaps (exact), then +0.5 a gap.
    expect(fresh.arrivals.map((a) => [sgtClock(a.at), a.errMin])).toEqual([
      ["11:06", 0],
      ["11:12", 0],
      ["11:18", 1.5],
    ]);
    const view = directionView(fresh, at("11:01"), "EWL");
    if (view.state === "closed") throw new Error("closed");
    expect(view.state).toBe("exact");
    expect(view.arrivals.map((a) => a.plusMinus)).toEqual([null, null, 2]);
    // 25 min later: 5–7 gaps away → ≈ ±3 (still under half the gap).
    const later = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now: at("11:25"), observations: [], sightings });
    expect(later.basis).toBe("same_day");
    expect(later.arrivals[0].errMin).toBeGreaterThan(1);
    expect(later.confidence).toBe("medium");
    expect(directionView(later, at("11:25"), "EWL").state).toBe("estimate");
  });

  it("a stale tap gives a range, not confident clock times (F2)", () => {
    // 11:00 tap, now 12:00: 10 gaps away → ±5 > half the gap → no same-day times.
    const sightings = [boarded("EW17", "EWL", "TO_EAST", "11:00")];
    const p = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now: at("12:00"), observations: [], sightings });
    expect(p.basis).not.toBe("same_day");
    expect(p.kind).toBe("range");
    // Same for one board reading 70 min ago.
    const observations: Observation[] = [{ station: "EW17", line: "EWL", direction: "TO_EAST", capturedAt: at("10:50"), minutes: [2, 8], source: "owner", status: "approved" }];
    expect(predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now: at("12:00"), observations }).kind).toBe("range");
  });

  it("rotated device ids can't move a prediction (public taps: own platform only, never over the owner)", () => {
    const owner = [boarded("EW17", "EWL", "TO_EAST", "11:00")];
    const now = at("11:02");
    const base = predict({ line: "EWL", direction: "TO_EAST", station: "EW16", now, observations: [], sightings: owner });
    // 30 taps from one network with rotating device ids, near and far from the owner's train, here and up the line.
    const spam: TrainSighting[] = Array.from({ length: 30 }, (_, i) => ({
      ...boarded(i % 2 ? "EW16" : "EW18", "EWL", "TO_EAST", "11:00"),
      at: at("11:00") + ((i % 5) - 2) * 40_000,
      source: "public",
      ipHash: "one-network",
      id: 100 + i,
    }));
    const attacked = predict({ line: "EWL", direction: "TO_EAST", station: "EW16", now, observations: [], sightings: [...owner, ...spam] });
    expect(attacked.arrivals.map((a) => a.at)).toEqual(base.arrivals.map((a) => a.at));
    expect(attacked.reason).toEqual(base.reason);
    // And elsewhere on the line nothing changes either.
    const up = (s: TrainSighting[]) => predict({ line: "EWL", direction: "TO_EAST", station: "EW15", now, observations: [], sightings: s }).arrivals.map((a) => a.at);
    expect(up([...owner, ...spam])).toEqual(up(owner));
  });

  it("a board reading at another station also anchors this one", () => {
    const observations: Observation[] = [{ station: "EW15", line: "EWL", direction: "TO_EAST", capturedAt: at("10:50"), minutes: [1, 4], source: "owner", status: "approved" }];
    // EW15 is downstream of EW17 by 5 min: trains passed EW17 at 10:46 and 10:49.
    const p = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now: at("10:50"), observations });
    expect(p.basis).toBe("same_day");
    expect(sgtClock(p.arrivals[0].at)).toBe("10:52"); // 10:49 + 3 min gap
  });

  it("an own boarding here is the anchor, with a plain reason", () => {
    const sightings = [boarded("EW17", "EWL", "TO_EAST", "10:14")];
    const p = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now: at("10:20"), observations: [], sightings });
    expect(p.reason).toEqual({ code: "boarded_ago", params: { minutes: 6 } });
    expect(p.arrivals[0].at).toBeGreaterThan(at("10:20") - MINUTE);
  });
});
