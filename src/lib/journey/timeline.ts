/**
 * Today's taps as a timeline: between two consecutive taps, the minutes
 * spent waiting on the platform, riding, changing trains or walking.
 */
import { stationForCode } from "../network";
import { HOUR, MINUTE } from "../time";

export type TimelineTap = { kind: string; at: number; station?: string | null };
export type SegmentKind = "wait" | "ride" | "change" | "walk";
export type Segment = { from: number; to: number; kind: SegmentKind; minutes: number };

/** Gaps longer than this are separate trips, not a segment. */
export const MAX_SEGMENT_MS = 3 * HOUR;

const sameStation = (a?: string | null, b?: string | null) => Boolean(a && b && stationForCode(a)?.slug === stationForCode(b)?.slug);

export function segmentKind(a: TimelineTap, b: TimelineTap): SegmentKind {
  if (a.kind === "board" && b.kind === "alight") return "ride";
  if (a.kind === "alight" && (b.kind === "board" || b.kind === "at_platform") && (sameStation(a.station, b.station) || !b.station || !a.station)) return "change";
  if (a.kind === "at_platform" && b.kind === "board") return "wait";
  return "walk";
}

/** Segments between consecutive taps (indices into the sorted list). */
export function deriveSegments(taps: TimelineTap[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 1; i < taps.length; i++) {
    const a = taps[i - 1];
    const b = taps[i];
    const gap = b.at - a.at;
    if (gap < 0 || gap > MAX_SEGMENT_MS) continue;
    out.push({ from: i - 1, to: i, kind: segmentKind(a, b), minutes: Math.round((gap / MINUTE) * 10) / 10 });
  }
  return out;
}

/** Minutes per kind across the day (e.g. total waiting). */
export function segmentTotals(segments: Segment[]): Record<SegmentKind, number> {
  const totals: Record<SegmentKind, number> = { wait: 0, ride: 0, change: 0, walk: 0 };
  for (const s of segments) totals[s.kind] = Math.round((totals[s.kind] + s.minutes) * 10) / 10;
  return totals;
}
