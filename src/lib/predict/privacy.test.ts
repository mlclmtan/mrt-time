import { describe, expect, it } from "vitest";
import { makeT } from "../i18n";
import { reasonText } from "../format";
import { publicPrediction, publicReason, publicSeenTrains } from "./privacy";
import { directionView } from "./board-view";
import type { Prediction } from "./types";

// Synthetic fixtures only.
const base: Prediction = {
  kind: "times",
  arrivals: [{ at: 1_000_000, inMin: 3 }],
  headwayMin: 5,
  waitMin: { min: 0, max: 5 },
  confidence: "high",
  basis: "same_day",
  reason: { code: "boarded_ago", params: { minutes: 4 } },
  band: "weekday_offpeak",
  unstable: false,
  anchorAt: 760_000,
  anchorKind: "boarded",
  anchorStation: "EW17",
};

describe("v2.2 owner privacy (visitors' copy)", () => {
  it("'someone got on or off' and 'seen at <station>' become 'from a train seen N min ago'", () => {
    const t = makeT("en");
    expect(reasonText(t, publicReason(base.reason))).toBe("From a train seen 4 min ago");
    expect(reasonText(t, publicReason({ code: "seen_elsewhere", params: { station: "EW17", minutes: 6, hops: 1 } }))).toBe("From a train seen 6 min ago");
    expect(reasonText(makeT("zh-Hant"), publicReason(base.reason), "zh-Hant")).toBe("根據 4 分鐘前看到的列車");
    // Platform screens and estimates are unchanged (no person behind them).
    const screen = { code: "reading_ago" as const, params: { minutes: 2 } };
    expect(publicReason(screen)).toBe(screen);
  });

  it("drops the anchor's kind and station; times stay", () => {
    const p = publicPrediction(base);
    expect(p.reason).toEqual({ code: "seen_ago", params: { minutes: 4 } });
    expect(p).not.toHaveProperty("anchorKind");
    expect(p).not.toHaveProperty("anchorStation");
    expect(p.arrivals).toEqual(base.arrivals);
    expect(p.anchorAt).toBe(base.anchorAt);
    // The board card reads it as "seen".
    const view = directionView(p, 760_000 + 4 * 60_000, "EWL");
    expect(view.state !== "closed" && view.reason).toEqual({ code: "seen_ago", minutes: 4 });
  });

  it("seen-today: times only", () => {
    expect(
      publicSeenTrains([
        { at: 1, how: "boarded", spreadMin: 0 },
        { at: 2, how: "passed", from: "EW16", spreadMin: 1 },
        { at: 3, how: "reading", spreadMin: 0 },
      ]),
    ).toEqual([
      { at: 1, how: "seen", spreadMin: 0 },
      { at: 2, how: "seen", spreadMin: 0 },
      { at: 3, how: "seen", spreadMin: 0 },
    ]);
  });
});
