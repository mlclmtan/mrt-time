/**
 * Train sightings: a real train seen at a platform at a known moment.
 *  - "boarded" / "alighted": someone got on / off a train there.
 *  - "board_reading": a platform-board reading implies a train at
 *    capturedAt + each minute shown.
 *
 * Error model (v2.1): nothing is exact. Every sighting carries an error in
 * minutes — a tap at "Now" ±0.5, a time moved with the chips / picker or a
 * board's next train ±1, a board's 2nd / 3rd train ±1.5. A sighting at
 * station X (direction D, time t) is the same train at the other stops of
 * D at t ± the ride minutes, with error + 0.3 min a stop (0.1 on measured
 * rides). It stops when the error passes 1.5 min, at the first possible
 * short-turn terminal (EW29 Joo Koon, TE4 Springleaf) unless the board
 * named the destination, and never starts from a boarding at a terminal
 * (trains wait there). Propagation happens at read time only; nothing
 * propagated is ever stored.
 *
 * Public sightings count only at their own platform and never outrank the
 * owner's / Hermes'; they propagate once two different networks (daily IP
 * hash) agree within 1 min. Board readings from the public stay at their
 * platform too.
 */
import { getDirection, isOriginTerminal, rideMeasured, stationForCode, trainOffset, type RideOverrides } from "../network";
import { MINUTE } from "../time";
import { BANDS, timeBand } from "./bands";
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
  /** When the evidence was observed (a board reading predicts later trains). Defaults to `at`. */
  seenAt?: number;
  /** When we learned about it (row created). Back-dated taps are known only from then. */
  recordedAt?: number;
  /** ± minutes on `at` (stored with the sighting; defaults by kind). */
  errMin?: number | null;
  /** Destination shown on the board, when known (early-ending trains). */
  destination?: string | null;
  tripEventId?: number | null;
  /** Owner / Hermes: whose trip (to pair a boarding with its getting off). Server-side only. */
  userId?: string | null;
  /** Public: salted daily network hash (agreement between networks). Server-side only. */
  ipHash?: string | null;
  /** Same physical train as other sightings with this ref (a boarding and its getting off). */
  ref?: string | null;
  /** The time was edited after logging (not scored for accuracy). */
  editedAt?: number | null;
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
  /** ± minutes around `at` (error model above). */
  errMin: number;
  /** Whole-minute ± for display: 0 when within a minute, else ⌈errMin⌉. */
  spreadMin: number;
  seenAt: number;
  /** Shared by every train derived from the same sighting / ride. */
  ref?: string;
  /** Public sighting confirmed by a second network. */
  corroborated?: boolean;
};

/* ---------- Error model ---------- */

export const ERR_TAP_NOW_MIN = 0.5;
export const ERR_CHOSEN_MIN = 1;
export const ERR_READING_FIRST_MIN = 1;
export const ERR_READING_LATER_MIN = 1.5;
export const ERR_PER_HOP_MIN = 0.3;
export const ERR_PER_MEASURED_HOP_MIN = 0.1;
/** Propagation stops once the error passes this. */
export const MAX_PROPAGATED_ERR_MIN = 1.5;
/** Two public sightings from different networks this close agree. */
export const CORROBORATE_MIN = 1;
/** A tap logged more than this after its time was moved back ("chosen", not "now"). */
export const NOW_TAP_LAG_MS = 60_000;

/** Error of a tap: "Now" ±0.5; a time moved back with the chips / picker ±1. */
export function tapError(timeChosen: boolean): number {
  return timeChosen ? ERR_CHOSEN_MIN : ERR_TAP_NOW_MIN;
}

/** The stored error, else a default by kind (a tap recorded much later than its time was chosen by hand). */
export function sightingError(s: Pick<TrainSighting, "errMin" | "kind" | "at" | "recordedAt">): number {
  if (s.errMin != null && Number.isFinite(s.errMin)) return s.errMin;
  if (s.kind === "board_reading") return ERR_READING_FIRST_MIN;
  return s.recordedAt != null && s.recordedAt - s.at > NOW_TAP_LAG_MS ? ERR_CHOSEN_MIN : ERR_TAP_NOW_MIN;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const displaySpread = (errMin: number) => (errMin <= 1 ? 0 : Math.ceil(errMin));

/** Error added by riding `between` (stops in running order): 0.1 a stop on measured rides, else 0.3. */
export function propagationError(between: string[], learned?: RideOverrides | null): number {
  const hops = between.length - 1;
  if (hops <= 0) return 0;
  if (rideMeasured(between[0], between[hops], learned)) return round2(hops * ERR_PER_MEASURED_HOP_MIN);
  let e = 0;
  for (let i = 1; i <= hops; i++) e += rideMeasured(between[i - 1], between[i], learned) ? ERR_PER_MEASURED_HOP_MIN : ERR_PER_HOP_MIN;
  return round2(e);
}

/** The trains a board reading implies (one per minute shown): next ±1, later ones ±1.5. */
export function readingSightings(obs: Observation): TrainSighting[] {
  return obs.minutes.map((m, i) => ({
    id: obs.id,
    station: obs.station,
    line: obs.line,
    direction: obs.direction,
    at: obs.capturedAt + m * MINUTE,
    kind: "board_reading" as const,
    source: obs.source,
    status: obs.status,
    seenAt: obs.capturedAt,
    recordedAt: obs.capturedAt,
    errMin: i === 0 ? ERR_READING_FIRST_MIN : ERR_READING_LATER_MIN,
    destination: obs.destination ?? null,
    ref: `r:${obs.id ?? `${obs.station}@${obs.capturedAt}`}:${i}`,
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

/**
 * Where propagation downstream of `from` must stop: the early terminal the
 * board named, else the first possible short-turn terminal (EW29, TE4)
 * unless the board named the line's real terminal.
 */
export function shortTurnStop(line: string, direction: string, from: string, destination?: string | null): string | null {
  const early = earlyTerminal(line, direction, destination);
  if (early) return early;
  const d = getDirection(line, direction);
  if (!d?.alsoTerminals?.length) return null;
  if (destination) {
    const end = stationForCode(d.terminal)?.name;
    const want = destination.trim();
    if (end && (end.en.toLowerCase() === want.toLowerCase() || end["zh-Hant"] === want)) return null;
  }
  for (const p of d.paths) {
    const i = p.indexOf(from);
    if (i < 0) continue;
    const hit = p.slice(i + 1).find((c) => d.alsoTerminals!.includes(c));
    if (hit) return hit;
  }
  return null;
}

/** A sighting that can't time a train: a boarding where trains wait at the start of their run. */
export function unusableSighting(s: Pick<TrainSighting, "kind" | "line" | "direction" | "station">): boolean {
  return s.kind === "boarded" && isOriginTerminal(s.line, s.direction, s.station);
}

export type PropagationOpts = {
  /** False while the line has a disruption (or the v1 predictor is on): sightings stay at their platform. */
  propagate?: boolean;
  /** Ride minutes learned from the owner's trips. */
  rides?: RideOverrides | null;
  /** Public sightings confirmed by a second network (may propagate). */
  corroborated?: ReadonlySet<TrainSighting>;
};

/** The same train at platform `to`, or null when it doesn't pass there or the error got too big. */
export function trainAt(s: TrainSighting, to: string, opts: PropagationOpts = {}): KnownTrain | null {
  if (unusableSighting(s)) return null;
  const corroborated = s.source === "public" && Boolean(opts.corroborated?.has(s));
  const mayPropagate = opts.propagate !== false && (s.source !== "public" || corroborated);
  if (s.station !== to && !mayPropagate) return null;
  const stopAt = shortTurnStop(s.line, s.direction, s.station, s.destination);
  const off = trainOffset(s.line, s.direction, s.station, to, stopAt, opts.rides);
  if (!off) return null;
  const errMin = round2(sightingError(s) + propagationError(off.between, opts.rides));
  if (off.hops !== 0 && errMin > MAX_PROPAGATED_ERR_MIN) return null;
  return {
    station: to,
    line: s.line,
    direction: s.direction,
    at: s.at + off.minutes * MINUTE,
    kind: s.kind,
    source: s.source,
    origin: s.station,
    hops: Math.abs(off.hops),
    errMin,
    spreadMin: displaySpread(errMin),
    seenAt: s.seenAt ?? s.at,
    ref: s.ref ?? (s.id != null ? `s:${s.id}` : undefined),
    ...(corroborated ? { corroborated } : {}),
  };
}

/** Every stop of the train's run that a sighting tells us about (incl. itself). */
export function propagate(s: TrainSighting, stops: string[], opts: PropagationOpts = {}): KnownTrain[] {
  return stops.map((code) => trainAt(s, code, opts)).filter((t): t is KnownTrain => t != null);
}

/* ---------- Same train seen twice: merge ---------- */

const isPublic = (t: Pick<KnownTrain, "source">) => t.source === "public";
const KIND_RANK: Record<SightingKind, number> = { boarded: 0, alighted: 1, board_reading: 2 };
/** Negative when `a` is the better evidence: owner/Hermes over public, then lower error, then fewer stops away. */
export function betterTrain(a: KnownTrain, b: KnownTrain): number {
  return (
    Number(isPublic(a)) - Number(isPublic(b)) ||
    a.errMin - b.errMin ||
    a.hops - b.hops ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    b.seenAt - a.seenAt
  );
}

/** Shortest gap between trains at this time of day (2 min in peaks, 5 otherwise). */
export function minHeadwayAt(at: number): number {
  return BANDS[timeBand(at)].range[0];
}

/**
 * Same physical train? Yes when both come from the same sighting or ride;
 * else when closer than max(1.5, sum of errors) min AND under half the
 * shortest gap. A public sighting near an owner/Hermes train within half
 * the gap is always that train (it never outranks it).
 */
export function sameTrain(a: KnownTrain, b: KnownTrain): boolean {
  if (a.ref && a.ref === b.ref) return true;
  const d = Math.abs(a.at - b.at) / MINUTE;
  const half = minHeadwayAt(Math.min(a.at, b.at)) / 2;
  if (isPublic(a) !== isPublic(b)) return d < half;
  return d < Math.max(1.5, a.errMin + b.errMin) && d < half;
}

/** One entry per real train: keep the best evidence for each (never averaged). */
export function dedupeTrains(trains: KnownTrain[]): KnownTrain[] {
  const sorted = [...trains].sort((a, b) => a.at - b.at);
  const out: KnownTrain[] = [];
  for (const t of sorted) {
    let merged = false;
    for (let k = out.length - 1; k >= Math.max(0, out.length - 4); k--) {
      if (!sameTrain(out[k], t)) continue;
      if (betterTrain(t, out[k]) < 0) out[k] = t;
      merged = true;
      break;
    }
    if (!merged) out.push(t);
  }
  return out.sort((a, b) => a.at - b.at);
}

/* ---------- Rides and public agreement ---------- */

/**
 * Pair each owner/Hermes boarding with the getting off that follows it
 * (same person, line and direction, nothing in between, ≤ 2 h): both get the
 * same `ref`, so the two count as one train.
 */
export function linkRides(sightings: TrainSighting[]): TrainSighting[] {
  const byUser = new Map<string, TrainSighting[]>();
  for (const s of sightings) if (s.userId && s.source !== "public") byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  const refs = new Map<TrainSighting, string>();
  for (const list of byUser.values()) {
    const sorted = [...list].sort((a, b) => a.at - b.at);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const b = sorted[i];
      const a = sorted[i + 1];
      if (b.kind !== "boarded" || a.kind !== "alighted" || a.line !== b.line || a.direction !== b.direction || a.at - b.at > 120 * MINUTE) continue;
      const ref = `ride:${b.id ?? b.tripEventId ?? b.at}`;
      refs.set(b, ref);
      refs.set(a, ref);
    }
  }
  return refs.size ? sightings.map((s) => (refs.has(s) ? { ...s, ref: refs.get(s)! } : s)) : sightings;
}

/** Public sightings (approved or awaiting review) that a second network confirms: same platform and direction, within 1 min. */
const CORROBORATED = new WeakMap<TrainSighting[], Set<TrainSighting>>();
export function corroboratedSightings(sightings: TrainSighting[]): Set<TrainSighting> {
  const cached = CORROBORATED.get(sightings);
  if (cached) return cached;
  const pub = sightings.filter((s) => s.source === "public" && s.status !== "rejected" && s.ipHash);
  const out = new Set<TrainSighting>();
  for (let i = 0; i < pub.length; i++)
    for (let j = i + 1; j < pub.length; j++) {
      const a = pub[i];
      const b = pub[j];
      if (a.ipHash === b.ipHash || a.station !== b.station || a.line !== b.line || a.direction !== b.direction) continue;
      if (Math.abs(a.at - b.at) <= CORROBORATE_MIN * MINUTE) {
        out.add(a);
        out.add(b);
      }
    }
  CORROBORATED.set(sightings, out);
  return out;
}

/**
 * Known trains at one platform/direction from approved sightings anywhere
 * on the line (and from readings), merged, oldest first.
 */
export function knownTrainsAt(
  target: { station: string; line: string; direction: string },
  sightings: TrainSighting[],
  observations: Observation[] = [],
  opts: Omit<PropagationOpts, "corroborated"> = {},
): KnownTrain[] {
  const all: KnownTrain[] = [];
  const full: PropagationOpts = { ...opts, corroborated: corroboratedSightings(sightings) };
  const consider = (s: TrainSighting) => {
    // Approved evidence, plus public taps two networks agree on (even while awaiting review).
    const usable = s.status === "approved" || (s.status === "pending" && full.corroborated!.has(s));
    if (!usable || s.line !== target.line || s.direction !== target.direction) return;
    const t = trainAt(s, target.station, full);
    if (t) all.push(t);
  };
  for (const s of sightings) consider(s);
  for (const o of observations) if (o.line === target.line && o.direction === target.direction) for (const s of readingSightings(o)) consider(s);
  return dedupeTrains(all);
}
