/** Journey-aware one-tap logging: the expected sequence of taps for a journey. */
import type { Leg } from "./plan";

export type StepKind = "at_platform" | "board" | "alight" | "tap_out" | "arrived";
export type Step = { kind: StepKind; station?: string; line?: string; direction?: string };

export function journeySteps(legs: Leg[]): Step[] {
  const steps: Step[] = [];
  for (const leg of legs) {
    if (leg.kind !== "ride") continue;
    steps.push({ kind: "at_platform", station: leg.from, line: leg.line, direction: leg.direction });
    steps.push({ kind: "board", station: leg.from, line: leg.line, direction: leg.direction });
    steps.push({ kind: "alight", station: leg.to, line: leg.line, direction: leg.direction });
  }
  const lastRide = [...legs].reverse().find((l) => l.kind === "ride");
  steps.push({ kind: "tap_out", station: lastRide?.kind === "ride" ? lastRide.to : undefined, line: lastRide?.kind === "ride" ? lastRide.line : undefined });
  steps.push({ kind: "arrived" });
  return steps;
}

/** Index of the next expected step given the kinds already logged (in order). */
export function nextStepIndex(steps: Step[], logged: { kind: string; station?: string | null }[]): number {
  let i = 0;
  for (const e of logged) {
    const idx = steps.findIndex((s, j) => j >= i && s.kind === e.kind && (!s.station || !e.station || s.station === e.station));
    if (idx >= 0) i = idx + 1;
  }
  return Math.min(i, steps.length);
}

/** Morning → first journey from home; afternoon → back home. */
export function suggestedJourney<J extends { key: string; fromPlace: string | null }>(journeys: J[], sgtHour: number): J | undefined {
  const wantFrom = sgtHour < 12 ? "home" : "office";
  return journeys.find((j) => j.fromPlace === wantFrom) ?? journeys[0];
}
