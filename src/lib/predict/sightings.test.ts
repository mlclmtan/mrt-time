import { describe, expect, it } from "vitest";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import { predict, type Observation } from "./index";
import { dedupeTrains, knownTrainsAt, propagate, propagationSpread, readingSightings, trainAt, type TrainSighting } from "./sightings";
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

describe("propagation along the line", () => {
  it("a 10:14 boarding at Tiong Bahru (EW17) towards Pasir Ris puts the train at Outram Park ≈10:17 and Tanjong Pagar ≈10:19", () => {
    const s = boarded("EW17", "EWL", "TO_EAST", "10:14");
    const outram = trainAt(s, "EW16")!;
    expect(sgtClock(outram.at)).toBe("10:17");
    expect(outram).toMatchObject({ hops: 1, spreadMin: 0, origin: "EW17", kind: "boarded" });
    expect(sgtClock(trainAt(s, "EW15")!.at)).toBe("10:19"); // EW15→EW17 observed 5 min
    // Backwards: it left Redhill (EW18) 2 min earlier (default 2 min a stop).
    const redhill = trainAt(s, "EW18")!;
    expect(sgtClock(redhill.at)).toBe("10:12");
    expect(redhill.hops).toBe(1);
  });

  it("uses observed ride times forward and backward (TE17→TE19 3 min, TE17→TE2 37 min)", () => {
    const tel = boarded("TE17", "TEL", "TO_BAYSHORE", "10:17");
    expect(sgtClock(trainAt(tel, "TE19")!.at)).toBe("10:20");
    const north = boarded("TE17", "TEL", "TO_NORTH", "08:00");
    expect(trainAt(north, "TE2")!.at - north.at).toBe(37 * MINUTE);
    // Backward from Woodlands: the train was at Outram Park 37 min earlier.
    const atWoodlands = boarded("TE2", "TEL", "TO_NORTH", "08:37");
    expect(sgtClock(trainAt(atWoodlands, "TE17")!.at)).toBe("08:00");
  });

  it("confidence decays with stops: exact ≤ 2 stops, then ±1 min per 4 further stops", () => {
    expect([0, 1, 2, 3, 6, 7, 10, 11].map(propagationSpread)).toEqual([0, 0, 0, 1, 1, 2, 2, 3]);
    const s = boarded("EW17", "EWL", "TO_EAST", "10:14");
    expect(trainAt(s, "EW13")!.spreadMin).toBe(1); // 4 stops
    expect(trainAt(s, "EW1")!.spreadMin).toBe(4); // 16 stops
    expect(trainAt(s, "EW1")!.at).toBeGreaterThan(s.at);
  });

  it("stops at the terminal and never crosses to the other direction or another line", () => {
    const s = boarded("EW17", "EWL", "TO_EAST", "10:14");
    const stops = propagate(s, ["EW1", "EW17", "EW33", "TE17"]);
    expect(stops.map((t) => t.station)).toEqual(["EW1", "EW17", "EW33"]);
    // EW33 is upstream (the train came from Tuas Link earlier).
    expect(stops[2].at).toBeLessThan(s.at);
    expect(trainAt(s, "CG2")).toBeNull();
  });

  it("branches: a Changi Airport train is only on the branch; trains early-ending at Springleaf stop there", () => {
    const branch = boarded("CG1", "EWL", "TO_CHANGI_AIRPORT", "12:00");
    expect(trainAt(branch, "CG2")).not.toBeNull();
    expect(trainAt(branch, "EW4")!.at).toBeLessThan(branch.at);
    expect(trainAt(branch, "EW3")).toBeNull();
    const reading: Observation = { station: "TE17", line: "TEL", direction: "TO_NORTH", destination: "Springleaf", capturedAt: at("09:00"), minutes: [2], source: "owner", status: "approved" };
    const [s] = readingSightings(reading);
    expect(trainAt(s, "TE5")).not.toBeNull();
    expect(trainAt(s, "TE3")).toBeNull(); // past Springleaf (TE4)
    // Unknown destination: carried on to the terminal.
    expect(trainAt({ ...s, destination: null }, "TE3")).not.toBeNull();
  });

  it("Circle Line: where its two routes split at Promenade the train's path is unknown, elsewhere it is not", () => {
    const s = boarded("CC32", "CCL", "TO_DHOBY_GHAUT", "10:00");
    expect(trainAt(s, "CC1")).not.toBeNull();
    const trunk = boarded("CC5", "CCL", "TO_PRINCE_EDWARD_ROAD", "10:00");
    expect(trainAt(trunk, "CC4")).not.toBeNull();
    expect(trainAt(trunk, "CC29")).not.toBeNull();
    const link = boarded("CC33", "CCL", "TO_PRINCE_EDWARD_ROAD", "10:00");
    expect(trainAt(link, "CC34")).not.toBeNull();
    // At Promenade a "Prince Edward Road" train goes via HarbourFront or via Marina Bay.
    const split = boarded("CC4", "CCL", "TO_PRINCE_EDWARD_ROAD", "10:00");
    expect(trainAt(split, "CC5")).toBeNull();
    expect(trainAt(split, "CC34")).toBeNull();
  });

  it("dedupes the same train seen twice, keeping the closer sighting", () => {
    const here = boarded("EW16", "EWL", "TO_EAST", "10:17");
    const far = boarded("EW17", "EWL", "TO_EAST", "10:14");
    const reading = readingSightings({ station: "EW16", line: "EWL", direction: "TO_EAST", capturedAt: at("10:15"), minutes: [2, 7], source: "public", status: "approved" });
    const trains = knownTrainsAt({ station: "EW16", line: "EWL", direction: "TO_EAST" }, [far, here, ...reading]);
    expect(trains.map((t) => sgtClock(t.at))).toEqual(["10:17", "10:22"]);
    expect(trains[0].kind).toBe("boarded");
    expect(dedupeTrains([])).toEqual([]);
    // Pending sightings are ignored.
    expect(knownTrainsAt({ station: "EW16", line: "EWL", direction: "TO_EAST" }, [{ ...here, status: "pending" }])).toEqual([]);
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

  it("a far-away sighting gives an estimate with a ± band", () => {
    const sightings = [boarded("EW29", "EWL", "TO_EAST", "09:40")];
    const now = at("09:45");
    const p = predict({ line: "EWL", direction: "TO_EAST", station: "EW17", now, observations: [], sightings });
    expect(p.basis).toBe("same_day");
    expect(p.spreadMin).toBeGreaterThan(0);
    const view = directionView(p, now, "EWL");
    expect(view.state).toBe("estimate");
    if (view.state !== "closed") expect(view.plusMinus).toBe(p.spreadMin);
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
