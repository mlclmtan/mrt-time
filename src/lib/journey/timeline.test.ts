import { describe, expect, it } from "vitest";
import { sgtInstant } from "../time";
import { deriveSegments, segmentTotals } from "./timeline";
import { backtestSightings } from "../predict/accuracy";
import type { TrainSighting } from "../predict/sightings";

const at = (clock: string, date = "2026-11-10") => sgtInstant(date, clock);

describe("today's timeline", () => {
  it("derives wait, ride, change (0 min is real) and walk segments", () => {
    const taps = [
      { kind: "door", at: at("10:00") },
      { kind: "at_platform", at: at("10:12"), station: "EW17" },
      { kind: "board", at: at("10:14"), station: "EW17" },
      { kind: "alight", at: at("10:17"), station: "EW16" },
      { kind: "board", at: at("10:17"), station: "TE17" },
      { kind: "alight", at: at("10:20"), station: "TE19" },
      { kind: "desk", at: at("10:31") },
    ];
    const segs = deriveSegments(taps);
    expect(segs.map((s) => [s.kind, s.minutes])).toEqual([
      ["walk", 12],
      ["wait", 2],
      ["ride", 3],
      ["change", 0],
      ["ride", 3],
      ["walk", 11],
    ]);
    expect(segmentTotals(segs)).toEqual({ walk: 23, wait: 2, ride: 6, change: 0 });
  });

  it("skips gaps over 3 hours (separate trips)", () => {
    expect(deriveSegments([{ kind: "desk", at: at("09:00") }, { kind: "desk", at: at("18:00") }])).toEqual([]);
  });
});

describe("accuracy against boardings", () => {
  const s = (station: string, clock: string, extra: Partial<TrainSighting> = {}): TrainSighting => ({
    station,
    line: "EWL",
    direction: "TO_EAST",
    at: at(clock),
    kind: "boarded",
    source: "owner",
    status: "approved",
    ...extra,
  });

  it("replays the prediction from before each boarding and scores it", () => {
    // 10:14 at Tiong Bahru predicts Outram Park 10:17; someone boards there at 10:17 → hit.
    const rows = backtestSightings([s("EW17", "10:14"), s("EW16", "10:17")], []);
    const outram = rows.find((r) => r.station === "EW16")!;
    expect(outram).toMatchObject({ hit: true, basis: "same_day", line: "EWL" });
    // The first boarding had nothing before it: a range, not scored.
    expect(rows.find((r) => r.station === "EW17")!.hit).toBeNull();
    // A boarding 4 min off the predicted train is a miss.
    const miss = backtestSightings([s("EW17", "10:14"), s("EW16", "10:21")], []).find((r) => r.station === "EW16")!;
    expect(miss.hit).toBe(false);
  });

  it("never uses the boarding itself or anything recorded later", () => {
    const rows = backtestSightings([s("EW16", "10:17"), s("EW17", "10:30")], []);
    expect(rows.find((r) => r.station === "EW16")!.basis).not.toBe("same_day");
  });
});
