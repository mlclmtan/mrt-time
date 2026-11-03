import { predict, type Observation, type Prediction, type UnstableWindow } from "../predict";
import type { RideLeg, TrainSchedule, TrainSource } from "./plan";

export function scheduleFromPrediction(p: Prediction): TrainSchedule {
  if (p.kind === "times" && p.arrivals.length)
    return { kind: "times", times: p.arrivals.map((a) => a.at), headwayMin: p.headwayMin, confidence: p.confidence, reason: p.reason, ...(p.anchorAt != null ? { anchorAt: p.anchorAt } : {}) };
  return { kind: "headway", headwayMin: p.headwayMin || 6, confidence: p.kind === "closed" ? "low" : p.confidence, reason: p.reason };
}

/** A TrainSource that runs the prediction engine at the moment it is asked about. */
export function predictionSource(
  observations: Observation[],
  unstableWindows?: UnstableWindow[],
): TrainSource {
  return (leg: RideLeg, around: number) =>
    scheduleFromPrediction(
      predict({
        line: leg.line,
        direction: leg.direction,
        station: leg.from,
        now: around,
        observations,
        unstableWindows,
      }),
    );
}

/** Rain words in data.gov.sg 2-hour forecasts. */
export function isRainy(forecast: string | null | undefined) {
  return Boolean(forecast && /rain|shower|thunder/i.test(forecast));
}

/** When rain is forecast, prefer the sheltered variant among alternatives. */
export function shelteredSuggestion<J extends { id: number; sheltered: boolean }>(
  journeys: J[],
  rainy: boolean,
): J | null {
  if (!rainy) return null;
  return journeys.find((j) => j.sheltered) ?? null;
}
