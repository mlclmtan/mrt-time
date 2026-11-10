/**
 * Ride minutes learned from the owner's own trips: every "I boarded" at A
 * followed by "Got off" at B (same line and direction, nothing else logged
 * in between, under 2 h) is one sample of A→B. With ≥ 3 samples the median
 * replaces the default (2 min a stop) for propagation along the line.
 */
import { getPlatform, type RideOverrides } from "../network";
import { MINUTE, median } from "../time";

export const MIN_RIDE_SAMPLES = 3;
const MAX_RIDE_MS = 120 * MINUTE;

export type RideTap = { userId?: string | null; kind: string; at: number; station: string | null; line?: string | null; direction: string | null };

/** "A>B" → median ride minutes (one decimal) for pairs with ≥ 3 samples. */
export function learnRideTimes(taps: RideTap[], minSamples = MIN_RIDE_SAMPLES): RideOverrides {
  const samples = new Map<string, number[]>();
  const byUser = new Map<string, RideTap[]>();
  for (const t of taps) byUser.set(t.userId ?? "", [...(byUser.get(t.userId ?? "") ?? []), t]);
  for (const list of byUser.values()) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const b = sorted[i];
      const a = sorted[i + 1];
      if (b.kind !== "board" || a.kind !== "alight" || !b.station || !a.station || b.station === a.station) continue;
      const pb = getPlatform(b.station);
      const pa = getPlatform(a.station);
      if (!pb || !pa || pb.line !== pa.line) continue;
      if (b.direction && a.direction && b.direction !== a.direction) continue;
      const ms = a.at - b.at;
      if (ms <= 0 || ms > MAX_RIDE_MS) continue;
      const k = `${b.station}>${a.station}`;
      samples.set(k, [...(samples.get(k) ?? []), ms / MINUTE]);
    }
  }
  const out: Record<string, number> = {};
  for (const [k, v] of samples) if (v.length >= minSamples) out[k] = Math.round(median(v)! * 10) / 10;
  return out;
}
