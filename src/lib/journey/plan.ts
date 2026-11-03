/**
 * Door-to-door planner over fixed legs: walk (fixed min), ride (line, from,
 * to, direction) and transfer (fixed min). Train times come from a
 * TrainSource so the planner stays pure and testable.
 */
import { rideMinutes, type Route } from "../network";
import { MINUTE } from "../time";
import type { Confidence } from "../predict/types";

export type WalkLeg = { kind: "walk"; min: number; label?: string; tip?: string };
export type RideLeg = {
  kind: "ride";
  line: string;
  from: string;
  to: string;
  direction: string;
  rideMin?: number;
  tip?: string;
};
export type TransferLeg = { kind: "transfer"; min: number; at?: string; tip?: string };
export type Leg = WalkLeg | RideLeg | TransferLeg;

export type TrainSchedule =
  | { kind: "times"; times: number[]; headwayMin: number; confidence: Confidence }
  | { kind: "headway"; headwayMin: number; confidence: Confidence };
/** Trains for a ride leg around the time we reach (or must leave) its platform. */
export type TrainSource = (leg: RideLeg, around: number) => TrainSchedule;

export type CatchLabel = "tight" | "likely" | "wait";
export type PlannedLeg = {
  leg: Leg;
  start: number;
  end: number;
  /** Ride legs only. */
  boardAt?: number;
  slackMin?: number;
  catch?: CatchLabel;
  estimate?: boolean;
  confidence?: Confidence;
};
export type Plan = {
  departAt: number;
  arriveAt: number;
  best: number;
  worst: number;
  legs: PlannedLeg[];
  confidence: Confidence;
};

const EPS = 1000; // a train arriving within a second of you still counts
const TIGHT_MIN = 1;
const LIKELY_MIN = 3;

export function legRideMin(leg: RideLeg) {
  return leg.rideMin ?? rideMinutes(leg.from, leg.to);
}

/*
 * A schedule's trains are extended in both directions by the headway so
 * forward and backward searches agree before/after the listed times.
 */
/** First train at/after t. */
function nextTrain(s: Extract<TrainSchedule, { kind: "times" }>, t: number): number {
  const first = s.times[0];
  if (first == null) return t;
  const step = s.headwayMin * MINUTE;
  if (t - EPS < first) return first - Math.floor((first - t + EPS) / step) * step;
  const found = s.times.find((x) => x >= t - EPS);
  if (found != null) return found;
  const last = s.times[s.times.length - 1];
  return last + Math.ceil((t - EPS - last) / step) * step;
}
/** Last train at/before t. */
function prevTrain(s: Extract<TrainSchedule, { kind: "times" }>, t: number): number {
  const last = s.times[s.times.length - 1];
  if (last == null) return t;
  const step = s.headwayMin * MINUTE;
  if (t + EPS > last) return last + Math.floor((t + EPS - last) / step) * step;
  const found = [...s.times].reverse().find((x) => x <= t + EPS);
  if (found != null) return found;
  const first = s.times[0];
  return first - Math.ceil((first - t - EPS) / step) * step;
}

const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
const lowest = (a: Confidence, b: Confidence) => (rank[a] <= rank[b] ? a : b);

function catchLabel(slackMin: number): CatchLabel {
  if (slackMin <= TIGHT_MIN) return "tight";
  if (slackMin <= LIKELY_MIN) return "likely";
  return "wait";
}

/** Leave at `departAt`: catch the first reachable train on every ride. */
export function planForward(legs: Leg[], departAt: number, source: TrainSource): Plan {
  let t = departAt;
  let best = departAt;
  let worst = departAt;
  let confidence: Confidence = "high";
  const out: PlannedLeg[] = [];
  for (const leg of legs) {
    if (leg.kind !== "ride") {
      const start = t;
      t += leg.min * MINUTE;
      best += leg.min * MINUTE;
      worst += leg.min * MINUTE;
      out.push({ leg, start, end: t });
      continue;
    }
    const ride = legRideMin(leg) * MINUTE;
    const s = source(leg, t);
    confidence = lowest(confidence, s.confidence);
    let boardAt: number;
    if (s.kind === "times") {
      boardAt = nextTrain(s, t);
      const bestBoard = nextTrain(s, best);
      let worstBoard = nextTrain(s, worst);
      // A tight catch in the worst case means the next train.
      if (worstBoard - worst <= TIGHT_MIN * MINUTE) worstBoard = nextTrain(s, worstBoard + EPS * 2);
      best = bestBoard + ride;
      worst = worstBoard + ride + (s.confidence === "high" ? 0 : MINUTE);
    } else {
      boardAt = t + (s.headwayMin / 2) * MINUTE;
      best = best + ride;
      worst = worst + s.headwayMin * MINUTE + ride;
    }
    const slackMin = Math.round(((boardAt - t) / MINUTE) * 10) / 10;
    out.push({
      leg,
      start: t,
      boardAt,
      end: boardAt + ride,
      slackMin,
      catch: s.kind === "times" ? catchLabel(slackMin) : "wait",
      estimate: s.kind !== "times",
      confidence: s.confidence,
    });
    t = boardAt + ride;
  }
  return { departAt, arriveAt: t, best: Math.min(best, t), worst: Math.max(worst, t), legs: out, confidence };
}

/** Latest departure that still arrives by `arriveBy` (backward chaining). */
export function planLeaveBy(legs: Leg[], arriveBy: number, source: TrainSource): Plan {
  let need = arriveBy; // must be at the end of the current leg by this time
  for (let i = legs.length - 1; i >= 0; i--) {
    const leg = legs[i];
    if (leg.kind !== "ride") {
      need -= leg.min * MINUTE;
      continue;
    }
    const latestBoard = need - legRideMin(leg) * MINUTE;
    const s = source(leg, latestBoard);
    need = s.kind === "times" ? prevTrain(s, latestBoard) : latestBoard - (s.headwayMin / 2) * MINUTE;
  }
  let departAt = need;
  let plan = planForward(legs, departAt, source);
  // Guard against rounding: step back until the forward plan fits.
  for (let i = 0; i < 30 && plan.arriveAt > arriveBy + EPS; i++) {
    departAt -= MINUTE;
    plan = planForward(legs, departAt, source);
  }
  return plan;
}

/** The next `count` sensible departures from `from`, sorted by departure. */
export function planList(legs: Leg[], from: number, source: TrainSource, count = 6): Plan[] {
  const firstRide = legs.findIndex((l) => l.kind === "ride");
  if (firstRide < 0) return [planForward(legs, from, source)];
  const before = legs
    .slice(0, firstRide)
    .reduce((sum, l) => sum + (l.kind === "ride" ? 0 : l.min), 0) * MINUTE;
  const s = source(legs[firstRide] as RideLeg, from + before);
  const departures: number[] = [];
  if (s.kind === "times") {
    let train = nextTrain(s, from + before);
    for (let i = 0; i < count; i++) {
      departures.push(train - before);
      train = nextTrain(s, train + EPS * 2);
    }
  } else {
    for (let i = 0; i < count; i++) departures.push(from + i * s.headwayMin * MINUTE);
  }
  return departures
    .map((d) => planForward(legs, Math.max(d, from), source))
    .sort((a, b) => a.departAt - b.departAt || a.arriveAt - b.arriveAt);
}

/** Legs for a public station-to-station route with optional walks. */
export function routeToLegs(route: Route, walkBeforeMin = 0, walkAfterMin = 0): Leg[] {
  const legs: Leg[] = [];
  if (walkBeforeMin > 0) legs.push({ kind: "walk", min: walkBeforeMin });
  for (const step of route.steps) {
    if (step.kind === "ride")
      legs.push({
        kind: "ride",
        line: step.line,
        from: step.from,
        to: step.to,
        direction: step.direction,
        rideMin: step.rideMin,
      });
    else legs.push({ kind: "transfer", min: step.min, at: step.at });
  }
  if (walkAfterMin > 0) legs.push({ kind: "walk", min: walkAfterMin });
  return legs;
}

/** Fixed minutes of a journey (walks, transfers and rides). */
export function fixedMinutes(legs: Leg[]) {
  return legs.reduce((sum, l) => sum + (l.kind === "ride" ? legRideMin(l) : l.min), 0);
}
