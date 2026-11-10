/**
 * Train sightings: a real train seen at a platform at a known moment.
 *  - "boarded" / "alighted": someone got on / off a train there (exact).
 *  - "board_reading": a platform-board reading implies a train at
 *    capturedAt + each minute shown.
 * A sighting at station X (direction D, time t) is the same train at every
 * other stop of that direction at t ± the ride minutes between them
 * ("propagation"). Confidence decays with the number of stops in between.
 */
import { trainOffset, getDirection } from "../network";
import { MINUTE } from "../time";
import type { Observation, ReadingSource, ReadingStatus } from "./types";

export type SightingKind = "board_reading" | "boarded" | "alighted";

export type TrainSighting = {
  id?: number;
  station: string; // platform code
  line: string;
  direction: string;
  /** When the train was at the platform (ms). */
  at: number;
  kind: SightingKind;
  source: ReadingSource;
  status: ReadingStatus;
  /** When the evidence was recorded (a board reading predicts later trains). Defaults to `at`. */
  seenAt?: number;
  /** Destination shown on the board, when known (early-ending trains). */
  destination?: string | null;
  tripEventId?: number | null;
};

/** One train at one platform, derived from a sighting there or elsewhere. */
export type KnownTrain = {
  station: string;
  line: string;
  direction: string;
  at: number;
  kind: SightingKind;
  source: ReadingSource;
  /** Platform where the train was actually seen. */
  origin: string;
  /** Stops between the origin and this platform (0 = seen here). */
  hops: number;
  /** ± minutes around `at`. */
  spreadMin: number;
  seenAt: number;
};

/** Exact up to 2 stops away, then ±1 min for every 4 further stops. */
export const EXACT_HOPS = 2;
export const HOPS_PER_MINUTE = 4;
export function propagationSpread(hops: number): number {
  const h = Math.abs(hops);
  return h <= EXACT_HOPS ? 0 : Math.ceil((h - EXACT_HOPS) / HOPS_PER_MINUTE);
}

/** The trains a board reading implies (one per minute shown). */
export function readingSightings(obs: Observation): TrainSighting[] {
  return obs.minutes.map((m) => ({
    id: obs.id,
    station: obs.station,
    line: obs.line,
    direction: obs.direction,
    at: obs.capturedAt + m * MINUTE,
    kind: "board_reading" as const,
    source: obs.source,
    status: obs.status,
    seenAt: obs.capturedAt,
    destination: obs.destination ?? null,
  }));
}

/** Early terminal named on the board (e.g. "Springleaf" → TE4), if any. */
export function earlyTerminal(line: string, direction: string, destination?: string | null): string | null {
  if (!destination) return null;
  const d = getDirection(line, direction);
  const want = destination.trim().toLowerCase();
  const hit = d?.alsoBoard?.find((b) => b.en.toLowerCase() === want || b["zh-Hant"] === destination.trim());
  return hit?.terminal ?? null;
}

/** The same train at platform `to`, or null when it doesn't pass there. */
export function trainAt(s: TrainSighting, to: string): KnownTrain | null {
  const off = trainOffset(s.line, s.direction, s.station, to, earlyTerminal(s.line, s.direction, s.destination));
  if (!off) return null;
  return {
    station: to,
    line: s.line,
    direction: s.direction,
    at: s.at + off.minutes * MINUTE,
    kind: s.kind,
    source: s.source,
    origin: s.station,
    hops: Math.abs(off.hops),
    spreadMin: propagationSpread(off.hops),
    seenAt: s.seenAt ?? s.at,
  };
}

/** Every stop of the train's run that a sighting tells us about (incl. itself). */
export function propagate(s: TrainSighting, stops: string[]): KnownTrain[] {
  return stops.map((code) => trainAt(s, code)).filter((t): t is KnownTrain => t != null);
}

const KIND_RANK: Record<SightingKind, number> = { boarded: 0, alighted: 1, board_reading: 2 };
function better(a: KnownTrain, b: KnownTrain) {
  return a.spreadMin - b.spreadMin || a.hops - b.hops || KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.seenAt - a.seenAt;
}

/** One entry per real train: sightings within ~1 min (or their spread) are the same train. */
export function dedupeTrains(trains: KnownTrain[]): KnownTrain[] {
  const sorted = [...trains].sort((a, b) => a.at - b.at);
  const out: KnownTrain[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    const tol = Math.max(1, last?.spreadMin ?? 0, t.spreadMin) * MINUTE;
    if (last && t.at - last.at <= tol) {
      if (better(t, last) < 0) out[out.length - 1] = t;
    } else out.push(t);
  }
  return out;
}

/**
 * Known trains at one platform/direction from approved sightings anywhere
 * on the line (and from readings), deduplicated, oldest first.
 */
export function knownTrainsAt(
  target: { station: string; line: string; direction: string },
  sightings: TrainSighting[],
  observations: Observation[] = [],
): KnownTrain[] {
  const all: KnownTrain[] = [];
  const consider = (s: TrainSighting) => {
    if (s.status !== "approved" || s.line !== target.line || s.direction !== target.direction) return;
    const t = trainAt(s, target.station);
    if (t) all.push(t);
  };
  for (const s of sightings) consider(s);
  for (const o of observations) if (o.line === target.line && o.direction === target.direction) for (const s of readingSightings(o)) consider(s);
  return dedupeTrains(all);
}
