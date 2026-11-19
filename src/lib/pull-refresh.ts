/** Pull-to-refresh maths for the app shell's scrolling <main> (pure, tested). */
export const PULL_TRIGGER_PX = 64;
export const PULL_MAX_PX = 96;

/** Finger travel (px, downwards positive) → indicator height with rubber-band resistance. */
export function pullDistance(dy: number): number {
  if (!(dy > 0)) return 0;
  return Math.min(PULL_MAX_PX, Math.round(dy * 0.5));
}

export type PullPhase = "idle" | "pull" | "release" | "refreshing";

export function pullPhase(distance: number, refreshing: boolean): PullPhase {
  if (refreshing) return "refreshing";
  if (distance <= 0) return "idle";
  return distance >= PULL_TRIGGER_PX ? "release" : "pull";
}
