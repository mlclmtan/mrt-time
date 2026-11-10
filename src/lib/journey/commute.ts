/**
 * Owner Home "commute" view, pure and testable: which journey to show,
 * where the owner is along it (from today's taps), and the next
 * departures rendered as rows (leave → board leg 1 → transfer → board
 * leg 2 → arrive).
 */
import { HOUR, MINUTE, sgtDate, sgtMinuteOfDay } from "../time";
import type { Confidence } from "../predict/types";
import { PLATFORMS } from "../network/data";
import { journeySteps, nextStepIndex, JOURNEY_SWITCH_HOUR, type Step } from "./steps";
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
/** Once now is this far past the expected arrival, the trip is over ("Arrived ~10:25?"). */
export const FINISHED_AFTER_MS = 15 * MINUTE;
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

export type CommuteState = "idle" | "at_platform" | "on_board" | "between" | "finished";
export type CommuteProgress = {
  state: CommuteState;
  /** Index into the journey's legs where the remaining trip starts. */
  fromLeg: number;
  /**
   * When the remaining trip starts, from the tap times — never "now" once
   * moving: the end of the current ride (boarded + ride minutes), or the
   * moment you got off / tapped out. On the platform: now (still waiting).
   * "finished": the expected arrival.
   */
  startAt: number;
  /** "finished" only: when we expected you to arrive. */
  arrivedAt?: number;
};
type Tap = { kind: string; station?: string | null; at: number };

/** Minutes of the remaining legs with no waits (walks, changes, rides). */
function legsMinutes(legs: Leg[]) {
  return legs.reduce((sum, l) => sum + (l.kind === "ride" ? legRideMin(l) : l.min), 0);
}

/**
 * Where the owner is along ONE trip, from that trip's taps (see
 * `resolveTrip` for which taps belong to the current trip). Moving (on
 * board, got off, tapped out) and now past the expected arrival (tap times
 * + the remaining walks / changes / rides) + 15 min → "finished"
 * ("Arrived ~10:25?"), however old the taps are. On the platform with no
 * tap for 90 min → idle (the trip was abandoned).
 */
export function commuteProgress(legs: Leg[], taps: Tap[], now: number): CommuteProgress {
  const idle: CommuteProgress = { state: "idle", fromLeg: 0, startAt: now };
  const sorted = taps.filter((e) => e.at <= now + MINUTE).sort((a, b) => a.at - b.at);
  const latest = sorted.at(-1);
  if (!latest) return idle;
  const steps = journeySteps(legs);
  const idx = nextStepIndex(steps, sorted);
  if (idx === 0) return idle;
  const done = steps[idx - 1];
  const rideAt = legs.flatMap((l, i) => (l.kind === "ride" ? [i] : []));
  const ride = rideAt[Math.floor((idx - 1) / 3)];
  const lastOf = (kind: string) => [...sorted].reverse().find((e) => e.kind === kind)?.at ?? latest.at;
  const moving = (fromLeg: number, startAt: number, state: "on_board" | "between"): CommuteProgress => {
    const arrivedAt = startAt + legsMinutes(legs.slice(fromLeg)) * MINUTE;
    return now > arrivedAt + FINISHED_AFTER_MS ? { state: "finished", fromLeg, startAt: arrivedAt, arrivedAt } : { state, fromLeg, startAt };
  };
  switch (done.kind) {
    case "at_platform":
      return now - latest.at > PROGRESS_STALE_MS ? idle : { state: "at_platform", fromLeg: ride, startAt: now };
    case "board": {
      // The rest of the trip starts when this ride ends: boarded + ride minutes (not now).
      const leg = legs[ride];
      const boardedAt = lastOf("board");
      return moving(ride + 1, leg.kind === "ride" ? boardedAt + legRideMin(leg) * MINUTE : boardedAt, "on_board");
    }
    case "alight":
      return moving(ride + 1, lastOf("alight"), "between");
    case "tap_out":
      return moving((rideAt.at(-1) ?? legs.length - 1) + 1, lastOf("tap_out"), "between");
    default:
      // Arrived: the trip is over, so show the whole journey again.
      return idle;
  }
}

/* ---------- The one next-step resolver (button, card, /add) ---------- */

/** What the owner can tap: journey steps plus the two ends ("door" = home, "desk" = office). */
export type TapKind = "door" | "desk" | "at_platform" | "board" | "alight" | "tap_out" | "arrived";
/** "home" → the home door, "office" → the desk (journey ends for commute stats). */
export const placeKind = (place: string | null | undefined): TapKind => (place === "home" ? "door" : place === "office" ? "desk" : "arrived");
/** Cookie "unixMs": the last tap of the trip whose "Arrived ~10:25?" was dismissed. */
export const TRIP_DISMISSED_COOKIE = "mrt_trip_dismissed";
export function parseDismissed(value: string | null | undefined): number | null {
  return /^\d{10,14}$/.test(value ?? "") ? Number(value) : null;
}

export type NextStep = {
  kind: TapKind;
  /** "start" = leaving (Home door / Left desk), "end" = got there (At my desk). */
  role: "start" | "step" | "end";
  station?: string;
  line?: string;
  direction?: string;
};
export type TripStatus = {
  steps: Step[];
  /** The current trip's taps (today, after the last finished / ended / dismissed trip). */
  taps: Tap[];
  /** Index into `steps` the next ride step is looked up from (0 for a new trip). */
  stepIdx: number;
  /** Where the owner is; "finished" → "Arrived ~10:25?". */
  progress: CommuteProgress;
  next: NextStep | null;
  /** Latest tap of the current trip (what Dismiss remembers). */
  lastTapAt: number | null;
};
type JourneyLike = { legs: Leg[]; fromPlace?: string | null; toPlace?: string | null };

/**
 * The single place that turns today's taps into "where am I / what's
 * next" — the Home button, the trip card's request, the server-rendered
 * first view and /add's default platform all go through it.
 *  - Only today's taps (SGT) after `dismissedAt` count.
 *  - A trip ends at the end-place tap (desk / door / arrived); a start-place
 *    tap begins a new one; a tap made after the trip was already finished
 *    (or abandoned on the platform) begins a new one too.
 *  - Finished (now > expected arrival + 15 min, same rule as `commuteView`)
 *    → next is the end place ("Arrived ~10:25? · Log At my desk").
 *  - No trip under way (new day, new journey, ended, dismissed, abandoned)
 *    → next is the journey's first step (Home door / Left desk).
 * `serverFinishedAt`: the server's view already says finished (it planned
 * the rest with real train times) — honoured while the trip is moving.
 */
export function resolveTrip(
  journey: JourneyLike,
  taps: Tap[],
  now: number,
  opts: { dismissedAt?: number | null; serverFinishedAt?: number | null } = {},
): TripStatus {
  const steps = journeySteps(journey.legs);
  const startKind = placeKind(journey.fromPlace);
  const endKind = placeKind(journey.toPlace);
  const day = sgtDate(now);
  const sorted = taps
    .filter((e) => e.at <= now + MINUTE && sgtDate(e.at) === day && (opts.dismissedAt == null || e.at > opts.dismissedAt))
    .sort((a, b) => a.at - b.at);
  let trip: Tap[] = [];
  for (const e of sorted) {
    if (e.kind === endKind || e.kind === "arrived") trip = [];
    else if (e.kind === startKind) trip = [e];
    else {
      if (trip.length && isOver(journey.legs, trip, e.at)) trip = [];
      trip.push(e);
    }
  }
  let progress = commuteProgress(journey.legs, trip, now);
  // Abandoned (no tap for 90 min, not on a train): no trip under way.
  if (trip.length && progress.state !== "finished" && isOver(journey.legs, trip, now)) {
    trip = [];
    progress = commuteProgress(journey.legs, trip, now);
  }
  if ((progress.state === "on_board" || progress.state === "between") && opts.serverFinishedAt != null)
    progress = { ...progress, state: "finished", startAt: opts.serverFinishedAt, arrivedAt: opts.serverFinishedAt };
  const lastTapAt = trip.at(-1)?.at ?? null;
  const fresh = (): NextStep | null =>
    startKind !== "arrived" ? { kind: startKind, role: "start" } : steps[0] ? { ...stepOf(steps[0]), role: "step" } : null;

  if (progress.state === "finished") return { steps, taps: trip, stepIdx: 0, progress, next: { kind: endKind, role: "end" }, lastTapAt };
  const stepIdx = nextStepIndex(steps, trip);
  const started = trip.some((e) => e.kind !== startKind);
  const step = steps[stepIdx];
  const next: NextStep | null = !started
    ? trip.length
      ? step && { ...stepOf(step), role: "step" } // left the door: the first platform
      : fresh()
    : !step || step.kind === "arrived"
      ? { kind: endKind, role: "end" }
      : { ...stepOf(step), role: "step" };
  return { steps, taps: trip, stepIdx, progress, next: next ?? null, lastTapAt };
}

function stepOf(s: Step): Omit<NextStep, "role"> {
  return { kind: s.kind, ...(s.station ? { station: s.station } : {}), ...(s.line ? { line: s.line } : {}), ...(s.direction ? { direction: s.direction } : {}) };
}

/** The trip in `taps` is over at `at`: finished, or abandoned on the platform (90 min, no tap). */
function isOver(legs: Leg[], taps: Tap[], at: number) {
  const p = commuteProgress(legs, taps, at);
  return p.state === "finished" || (p.state !== "on_board" && p.state !== "between" && at - (taps.at(-1)?.at ?? at) > PROGRESS_STALE_MS);
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
  /** The trip if you set off at progress.startAt (finished: the next trip, from now). */
  leaveNow: DepartureRow | null;
  rows: DepartureRow[];
};

/**
 * Idle / on the platform: plan from now. Moving (on board, got off, tapped
 * out): plan the rest from the tap times, never re-plan the ride from now —
 * and once now is past the expected arrival + 15 min the trip is finished
 * ("Arrived ~10:25? Log desk / dismiss"). Finished: the whole journey again
 * from now underneath the prompt (the next trip's plan).
 */
export function commuteView(journeyKey: string, legs: Leg[], progress: CommuteProgress, source: TrainSource, now: number): CommuteView {
  const finished = (arrivedAt: number): CommuteView => {
    const fresh = legs.length ? departureRow(planForward(legs, now, source)) : null;
    return {
      journeyKey,
      progress: { ...progress, state: "finished", startAt: arrivedAt, arrivedAt },
      generatedAt: now,
      leaveNow: fresh,
      rows: fresh ? nextDepartures(legs, now, source) : [],
    };
  };
  if (progress.state === "finished") return finished(progress.arrivedAt ?? progress.startAt);
  const remaining = legs.slice(Math.min(Math.max(0, progress.fromLeg), legs.length));
  const moving = progress.state === "on_board" || progress.state === "between";
  if (!remaining.length) {
    if (moving && now > progress.startAt + FINISHED_AFTER_MS) return finished(progress.startAt);
    return { journeyKey, progress, generatedAt: now, leaveNow: null, rows: [] };
  }
  const start = moving ? progress.startAt : Math.max(now, progress.startAt);
  const leaveNow = departureRow(planForward(remaining, start, source));
  if (moving && now > leaveNow.arriveAt + FINISHED_AFTER_MS) return finished(leaveNow.arriveAt);
  return {
    journeyKey,
    progress,
    generatedAt: now,
    leaveNow,
    // Moving: the plan from the taps is the one that matters; no list of later departures.
    rows: moving ? [] : nextDepartures(remaining, start, source),
  };
}
