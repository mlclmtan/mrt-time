/**
 * What visitors may see about who saw a train (v2.2 owner privacy).
 *
 * Signed-in owners see how each train is known ("boarded", "got off",
 * "seen at Outram Park", a platform screen). Everyone else — public station
 * pages, `/api/board`, `/api/predict`, the public planner — gets times
 * only: every sighting reads "seen", with no source, no other station and
 * no "boarded" / "got off". Redacted on the server, so the detail never
 * reaches a visitor's browser.
 */
import type { Prediction } from "./types";

/** One train seen today at a platform: when, and how we know. */
export type SeenTrain = {
  at: number;
  /**
   * boarded = someone got on/off here; reading = shown on this platform
   * screen; passed = seen at another station; seen = any of these, for
   * visitors (no source).
   */
  how: "boarded" | "reading" | "passed" | "seen";
  /** Platform where it was seen, for "passed" (owner only). */
  from?: string;
  spreadMin: number;
};

/** Visitors: times only, every train "seen". */
export function publicSeenTrains(trains: readonly SeenTrain[]): SeenTrain[] {
  return trains.map((s) => ({ at: s.at, how: "seen" as const, spreadMin: 0 }));
}

/**
 * Visitors: "someone got on or off here" / "seen at Outram Park" read
 * "from a train seen N min ago" — never who, how or where.
 */
export function publicReason(reason: Prediction["reason"]): Prediction["reason"] {
  if (reason.code !== "boarded_ago" && reason.code !== "seen_elsewhere") return reason;
  return { code: "seen_ago", params: { minutes: Number(reason.params.minutes ?? 0) } };
}

/** Visitors' copy of a prediction (reason, anchor kind and station redacted). */
export function publicPrediction(p: Prediction): Prediction {
  const out: Prediction = { ...p, reason: publicReason(p.reason) };
  if (out.reason !== p.reason) delete out.anchorKind;
  if (out.anchorKind === "boarded" || out.anchorKind === "alighted") delete out.anchorKind;
  delete out.anchorStation;
  return out;
}
