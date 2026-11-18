import { describe, expect, it } from "vitest";
import {
  findCatchTrain,
  formatCountdown,
  formatToastSeconds,
  getJourneyStationRail,
  getRailNodeStatus,
  primaryActionForTrip,
  sgtClockSeconds,
} from "./trip-helpers";
import type { Leg } from "./plan";
import type { BoardArrival } from "../predict/board-view";
import type { OwnerJourney } from "../server/journeys";
import { en } from "../i18n/dict";

const sampleLegs: Leg[] = [
  { kind: "walk", min: 8, label: "Home → EW17 platform" },
  { kind: "ride", line: "EWL", from: "EW17", to: "EW16", direction: "TO_EAST", rideMin: 4, tip: "Door 3" },
  { kind: "transfer", min: 4, at: "outram-park" },
  { kind: "ride", line: "TEL", from: "TE17", to: "TE19", direction: "TO_BAYSHORE", rideMin: 5, tip: "Door 1" },
  { kind: "walk", min: 4, label: "TE19 → Office" },
];

const mockT = (key: string, params?: Record<string, string | number>) => {
  let str = (en as Record<string, string>)[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(`{${k}}`, String(v));
    }
  }
  return str;
};

describe("trip-helpers", () => {
  describe("sgtClockSeconds", () => {
    it("formats unix timestamp into HH:MM:SS in SGT (+8)", () => {
      // 10:14:32 SGT is 02:14:32 UTC
      const ts = Date.parse("2026-11-18T02:14:32Z");
      expect(sgtClockSeconds(ts)).toBe("10:14:32");
    });
  });

  describe("formatToastSeconds", () => {
    it("formats toast text with seconds for different tap kinds", () => {
      const ts = Date.parse("2026-11-18T02:14:32Z"); // 10:14:32 SGT
      expect(formatToastSeconds("board", ts, mockT)).toBe("Boarded 10:14:32");
      expect(formatToastSeconds("alight", ts, mockT)).toBe("Got off 10:14:32");
      expect(formatToastSeconds("desk", ts, mockT)).toBe("At desk 10:14:32");
      expect(formatToastSeconds("door", ts, mockT)).toBe("Home door 10:14:32");
      expect(formatToastSeconds("at_platform", ts, mockT)).toBe("At platform 10:14:32");
      expect(formatToastSeconds("tap_out", ts, mockT)).toBe("Tapped out 10:14:32");
    });
  });

  describe("getJourneyStationRail", () => {
    it("extracts sequential stations for EW17 -> EW16 (transfer) -> TE17 -> TE19", () => {
      const rail = getJourneyStationRail(sampleLegs, "en");
      expect(rail).toHaveLength(3);
      expect(rail[0].code).toBe("EW17");
      expect(rail[0].name).toBe("Tiong Bahru");
      expect(rail[0].isTransfer).toBe(false);

      expect(rail[1].code).toBe("TE17");
      expect(rail[1].name).toBe("Outram Park");
      expect(rail[1].isTransfer).toBe(true);

      expect(rail[2].code).toBe("TE19");
      expect(rail[2].name).toBe("Shenton Way");
      expect(rail[2].isTransfer).toBe(false);
    });
  });

  describe("getRailNodeStatus", () => {
    it("marks node status appropriately across commute states", () => {
      // Idle at start: Node 0 is current, others are next
      expect(getRailNodeStatus(0, 3, "idle", 0)).toBe("current");
      expect(getRailNodeStatus(1, 3, "idle", 0)).toBe("next");
      expect(getRailNodeStatus(2, 3, "idle", 0)).toBe("next");

      // On board Leg 1 (riding towards Outram Park): Node 0 done, Node 1 current (destination)
      expect(getRailNodeStatus(0, 3, "on_board", 0)).toBe("done");
      expect(getRailNodeStatus(1, 3, "on_board", 0)).toBe("current");
      expect(getRailNodeStatus(2, 3, "on_board", 0)).toBe("next");

      // Transferring at Outram Park: Node 0 done, Node 1 current, Node 2 next
      expect(getRailNodeStatus(0, 3, "between", 1)).toBe("done");
      expect(getRailNodeStatus(1, 3, "between", 1)).toBe("current");
      expect(getRailNodeStatus(2, 3, "between", 1)).toBe("next");

      // On board Leg 2 (riding towards Shenton Way): Node 0 & 1 done, Node 2 current
      expect(getRailNodeStatus(0, 3, "on_board", 1)).toBe("done");
      expect(getRailNodeStatus(1, 3, "on_board", 1)).toBe("done");
      expect(getRailNodeStatus(2, 3, "on_board", 1)).toBe("current");

      // Finished: all nodes done
      expect(getRailNodeStatus(0, 3, "finished", 2)).toBe("done");
      expect(getRailNodeStatus(1, 3, "finished", 2)).toBe("done");
      expect(getRailNodeStatus(2, 3, "finished", 2)).toBe("done");
    });
  });

  describe("findCatchTrain", () => {
    const mockTrains: BoardArrival[] = [
      { at: Date.parse("2026-11-18T02:15:00Z"), clock: "10:15", inMin: 1, plusMinus: null },
      { at: Date.parse("2026-11-18T02:19:00Z"), clock: "10:19", inMin: 5, plusMinus: null },
      { at: Date.parse("2026-11-18T02:24:00Z"), clock: "10:24", inMin: 10, plusMinus: null },
    ];

    it("identifies target train with normal wait time", () => {
      // Passenger reaches transfer platform at 10:17:00
      const reachAt = Date.parse("2026-11-18T02:17:00Z");
      const result = findCatchTrain(mockTrains, reachAt);
      expect(result.catchIndex).toBe(1); // 10:19 train
      expect(result.waitMin).toBe(2);
      expect(result.catchType).toBe("wait");
    });

    it("identifies target train as tight when arrival is within 60s of departure", () => {
      // Passenger reaches platform at 10:18:30 (30s before 10:19 train)
      const reachAt = Date.parse("2026-11-18T02:18:30Z");
      const result = findCatchTrain(mockTrains, reachAt);
      expect(result.catchIndex).toBe(1);
      expect(result.catchType).toBe("tight");
    });

    it("marks as missed when passenger arrives after all trains", () => {
      const reachAt = Date.parse("2026-11-18T02:26:00Z");
      const result = findCatchTrain(mockTrains, reachAt);
      expect(result.catchIndex).toBe(-1);
      expect(result.catchType).toBe("missed");
    });

    it("handles empty trains list gracefully", () => {
      const reachAt = Date.parse("2026-11-18T02:15:00Z");
      const result = findCatchTrain([], reachAt);
      expect(result.catchIndex).toBe(-1);
      expect(result.waitMin).toBe(0);
    });
  });

  describe("primaryActionForTrip", () => {
    const journey: Pick<OwnerJourney, "legs" | "fromPlace" | "toPlace"> = {
      legs: sampleLegs,
      fromPlace: "home",
      toPlace: "office",
    };

    it("advances through the full trip sequence without asking for time", () => {
      // 1. Idle at start: primary button is "I boarded" for EW17
      const a1 = primaryActionForTrip(journey, "idle", 0, []);
      expect(a1.kind).toBe("board");
      expect(a1.station).toBe("EW17");
      expect(a1.labelKey).toBe("trip.action.board");
      expect(a1.secondaryKind).toBe("at_platform");

      // 2. Tapped "I boarded" -> state is on_board Leg 1
      const tapsAfterBoard1 = [{ kind: "board" }];
      const a2 = primaryActionForTrip(journey, "on_board", 2, tapsAfterBoard1);
      expect(a2.kind).toBe("alight");
      expect(a2.station).toBe("EW16");
      expect(a2.labelKey).toBe("trip.action.alight");

      // 3. Tapped "Got off" -> state is between (transferring at Outram Park)
      const tapsAfterAlight1 = [{ kind: "board" }, { kind: "alight" }];
      const a3 = primaryActionForTrip(journey, "between", 2, tapsAfterAlight1);
      expect(a3.kind).toBe("board");
      expect(a3.station).toBe("TE17");
      expect(a3.labelKey).toBe("trip.action.board");

      // 4. Tapped "I boarded" Leg 2 -> state is on_board Leg 2
      const tapsAfterBoard2 = [{ kind: "board" }, { kind: "alight" }, { kind: "board" }];
      const a4 = primaryActionForTrip(journey, "on_board", 4, tapsAfterBoard2);
      expect(a4.kind).toBe("alight");
      expect(a4.station).toBe("TE19");
      expect(a4.labelKey).toBe("trip.action.alight");

      // 5. Tapped "Got off" Leg 2 -> state is between (final walk to desk)
      const tapsAfterAlight2 = [{ kind: "board" }, { kind: "alight" }, { kind: "board" }, { kind: "alight" }];
      const a5 = primaryActionForTrip(journey, "between", 5, tapsAfterAlight2);
      expect(a5.kind).toBe("desk");
      expect(a5.role).toBe("end");
      expect(a5.labelKey).toBe("trip.action.desk");

      // 6. Finished state
      const a6 = primaryActionForTrip(journey, "finished", 5, [...tapsAfterAlight2, { kind: "desk" }]);
      expect(a6.labelKey).toBe("trip.action.done");

      // Journey heading to home door
      const homeJourney = { ...journey, toPlace: "home" };
      const aHome = primaryActionForTrip(homeJourney, "between", 5, tapsAfterAlight2);
      expect(aHome.kind).toBe("door");
      expect(aHome.labelKey).toBe("trip.action.door");
    });
  });

  describe("formatCountdown", () => {
    it("formats milliseconds into m:ss", () => {
      expect(formatCountdown(187_000)).toBe("3:07");
      expect(formatCountdown(30_000)).toBe("0:30");
      expect(formatCountdown(0)).toBe("0:00");
      expect(formatCountdown(4500_000)).toBe("75 min");
    });
  });
});
