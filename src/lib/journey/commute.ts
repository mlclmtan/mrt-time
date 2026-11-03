/**
 * Owner Home "commute" view, pure and testable: which journey to show,
 * where the owner is along it (from today's taps), and the next
 * departures rendered as rows (leave → board leg 1 → transfer → board
 * leg 2 → arrive).
 */
import { HOUR, MINUTE, sgtMinuteOfDay } from "../time";
import type { Confidence } from "../predict/types";
import { PLATFORMS } from "../network/data";
import { journeySteps, nextStepIndex, JOURNEY_SWITCH_HOUR } from "./steps";
import {
  legRideMin,
  planForward,
  planList,
  type CatchLabel,
  type Leg,
  type Plan,
  type ScheduleReason,
  type TrainSource,
} from "./plan";

export const DEPARTURE_ROWS = 6;
/** A manual journey pick wins over the time-of-day default for this long. */
export const MANUAL_CHOICE_TTL_MS = 2 * HOUR;
/** Taps older than this no longer place the owner along the journey. */
export const PROGRESS_STALE_MS = 90 * MINUTE;
export const JOURNEY_CHOICE_COOKIE = "mrt_journey";

/* ---------- Journey choice ---------- */

export type JourneyChoice = { key: string; at: number };

/**
 * Before 14:00 SGT → Home→Office, from 14:00 → Office→Home, unless the
 * owner picked a journey by hand in the last 2 h.
 */
export function autoJourneyKey<J extends { key: string; fromPlace: string | null }>(
  journeys: J[],
  now: number,
  manual?: JourneyChoice | null,
): string | undefined {
  if (manual && now >= manual.at && now - manual.at < MANUAL_CHOICE_TTL_MS && journeys.some((j) => j.key === manual.key))
    return manual.key;
  const wantFrom = sgtMinuteOfDay(now) < JOURNEY_SWITCH_HOUR * 60 ? "home" : "office";
  return (journeys.find((j) => j.fromPlace === wantFrom) ?? journeys[0])?.key;
}

/** Cookie value "key.unixMs". */
export function serializeJourneyChoice(choice: JourneyChoice) {
  return `${choice.key}.${Math.round(choice.at)}`;
}
export function parseJourneyChoice(value: string | null | undefined): JourneyChoice | null {
  const match = /^([a-z0-9_-]{1,60})\.(\d{10,14})$/i.exec(value ?? "");
  return match ? { key: match[1], at: Number(match[2]) } : null;
}

/** Station slugs and walk minutes at the two ends of a journey (planner defaults). */
export function journeyEnds(legs: Leg[]) {
  const rideAt = legs.flatMap((l, i) => (l.kind === "ride" ? [i] : []));
  const first = legs[rideAt[0]];
  const last = legs[rideAt[rideAt.length - 1]];
  const walk = (ls: Leg[]) => ls.reduce((sum, l) => sum + (l.kind === "walk" ? l.min : 0), 0);
  return {
    from: first?.kind === "ride" ? PLATFORMS[first.from]?.station : undefined,
    to: last?.kind === "ride" ? PLATFORMS[last.to]?.station : undefined,
    walkFrom: rideAt.length ? walk(legs.slice(0, rideAt[0])) : 0,
    walkTo: rideAt.length ? walk(legs.slice(rideAt[rideAt.length - 1] + 1)) : 0,
  };
}

/* ---------- Where am I along the journey? ---------- */

export type CommuteState = "idle" | "at_platform" | "on_board" | "between";
export type CommuteProgress = {
  state: CommuteState;
  /** Index into the journey's legs where the remaining trip starts. */
  fromLeg: number;
  /** When the remaining trip starts (now, or when the current ride ends). */
  startAt: number;
};
type Tap = { kind: string; station?: string | null; at: number };

export function commuteProgress(legs: Leg[], taps: Tap[], now: number): CommuteProgress {
  const idle: CommuteProgress = { state: "idle", fromLeg: 0, startAt: now };
  const sorted = taps.filter((e) => e.at <= now + MINUTE).sort((a, b) => a.at - b.at);
  const latest = sorted.at(-1);
  if (!latest || now - latest.at > PROGRESS_STALE_MS) return idle;
  const steps = journeySteps(legs);
  const idx = nextStepIndex(steps, sorted);
  if (idx === 0) return idle;
  const done = steps[idx - 1];
  const rideAt = legs.flatMap((l, i) => (l.kind === "ride" ? [i] : []));
  const ride = rideAt[Math.floor((idx - 1) / 3)];
  switch (done.kind) {
    case "at_platform":
      return { state: "at_platform", fromLeg: ride, startAt: now };
    case "board": {
      const leg = legs[ride];
      const boardedAt = [...sorted].reverse().find((e) => e.kind === "board")?.at ?? now;
      const rideEnd = leg.kind === "ride" ? boardedAt + legRideMin(leg) * MINUTE : now;
      return { state: "on_board", fromLeg: ride + 1, startAt: Math.max(now, rideEnd) };
    }
    case "alight":
      return { state: "between", fromLeg: ride + 1, startAt: now };
    case "tap_out":
      return { state: "between", fromLeg: (rideAt.at(-1) ?? legs.length - 1) + 1, startAt: now };
    default:
      // Arrived: the trip is over, so show the whole journey again.
      return idle;
  }
}

/* ---------- Departure rows ---------- */

export type RideCell = {
  line: string;
  from: string;
  to: string;
  /** Board clock; for ranged legs, the earliest board. */
  boardAt: number;
  /** Ranged legs only: latest board (reach platform + one headway). */
  boardUntil?: number;
  /** Catch at the platform (meaningful at transfers). */
  catch?: CatchLabel;
  waitMin: number;
  ranged: boolean;
  confidence: Confidence;
  headwayMin?: number;
  reason?: ScheduleReason;
  /** Board reading behind the clock times (for "a reading N min ago"). */
  anchorAt?: number;
  tip?: string;
};
export type DepartureRow = {
  leaveAt: number;
  arriveAt: number;
  best: number;
  worst: number;
  /** Any leg is headway-only (unstable window / no clock data) → show ranges. */
  ranged: boolean;
  confidence: Confidence;
  rides: RideCell[];
};

export function departureRow(plan: Plan): DepartureRow {
  const rides: RideCell[] = [];
  for (const p of plan.legs) {
    if (p.leg.kind !== "ride") continue;
    const ranged = Boolean(p.estimate);
    rides.push({
      line: p.leg.line,
      from: p.leg.from,
      to: p.leg.to,
      boardAt: ranged ? p.start : (p.boardAt ?? p.start),
      ...(ranged ? { boardUntil: p.start + (p.headwayMin ?? 0) * MINUTE } : {}),
      ...(p.catch ? { catch: p.catch } : {}),
      waitMin: Math.max(0, Math.round(p.slackMin ?? 0)),
      ranged,
      confidence: p.confidence ?? plan.confidence,
      ...(p.headwayMin != null ? { headwayMin: p.headwayMin } : {}),
      ...(p.reason ? { reason: p.reason } : {}),
      ...(p.anchorAt != null ? { anchorAt: p.anchorAt } : {}),
      ...(p.leg.tip ? { tip: p.leg.tip } : {}),
    });
  }
  return {
    leaveAt: plan.departAt,
    arriveAt: plan.arriveAt,
    best: plan.best,
    worst: plan.worst,
    ranged: rides.some((r) => r.ranged),
    confidence: plan.confidence,
    rides,
  };
}

/** The next `count` departures from `from`, leave times strictly increasing. */
export function nextDepartures(legs: Leg[], from: number, source: TrainSource, count = DEPARTURE_ROWS): DepartureRow[] {
  const rows = planList(legs, from, source, count).map(departureRow);
  return rows.filter((r, i) => i === 0 || r.leaveAt > rows[i - 1].leaveAt);
}

export type CommuteView = {
  journeyKey: string;
  progress: CommuteProgress;
  generatedAt: number;
  /** "Leave now →": the trip if you set off at progress.startAt. */
  leaveNow: DepartureRow | null;
  rows: DepartureRow[];
};

export function commuteView(journeyKey: string, legs: Leg[], progress: CommuteProgress, source: TrainSource, now: number): CommuteView {
  const remaining = legs.slice(Math.min(Math.max(0, progress.fromLeg), legs.length));
  if (!remaining.length) return { journeyKey, progress, generatedAt: now, leaveNow: null, rows: [] };
  const start = Math.max(now, progress.startAt);
  return {
    journeyKey,
    progress,
    generatedAt: now,
    leaveNow: departureRow(planForward(remaining, start, source)),
    rows: nextDepartures(remaining, start, source),
  };
}
