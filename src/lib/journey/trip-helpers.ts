/**
 * Pure helpers for the Trip screen (/trip):
 * - Station rail extraction and status tracking
 * - Primary button action & label resolution per commute state
 * - Transfer catch train calculation
 * - Seconds-resolution clock formatting for the undo toast
 */
import { SGT_OFFSET, MINUTE } from "../time";
import type { Leg } from "./plan";
import type { CommuteState, TapKind } from "./commute";
import { getPlatform, stationForCode, type LineCode, getDirection } from "../network";
import type { DictKey, Locale } from "../i18n";
import type { BoardArrival } from "../predict/board-view";

/** Clock with seconds in Singapore Time (SGT): "10:14:32". */
export function sgtClockSeconds(instant: number): string {
  return new Date(instant + SGT_OFFSET).toISOString().slice(11, 19);
}

/** Formats the toast text with seconds: "Boarded 10:14:32". */
export function formatToastSeconds(
  kind: TapKind,
  timestamp: number,
  t: (key: DictKey, params?: Record<string, string | number>) => string,
): string {
  const time = sgtClockSeconds(timestamp);
  const key = `trip.logged.${kind}` as DictKey;
  try {
    const formatted = t(key, { time });
    if (formatted && formatted !== key) return formatted;
  } catch {
    // fallback below
  }
  return `${kind} ${time}`;
}

export type RailStationNode = {
  index: number;
  stationSlug: string;
  name: string;
  code: string;
  line: LineCode;
  isTransfer: boolean;
  legIndex: number;
};

/**
 * Extracts sequential station stops from a journey's ride legs for the top progress rail.
 * E.g. Tiong Bahru (EW17) — Outram Park (EW16/TE17) — Shenton Way (TE19).
 */
export function getJourneyStationRail(legs: Leg[], locale: Locale = "en"): RailStationNode[] {
  const rides = legs
    .map((l, i) => ({ leg: l, index: i }))
    .filter((item): item is { leg: Extract<Leg, { kind: "ride" }>; index: number } => item.leg.kind === "ride");

  if (!rides.length) return [];

  const nodes: RailStationNode[] = [];

  // First station: from of first ride
  const firstRide = rides[0];
  const firstPlatform = getPlatform(firstRide.leg.from);
  const firstStation = firstPlatform ? stationForCode(firstRide.leg.from) : undefined;
  nodes.push({
    index: 0,
    stationSlug: firstStation?.slug ?? firstRide.leg.from,
    name: firstStation?.name[locale] ?? firstRide.leg.from,
    code: firstRide.leg.from,
    line: firstRide.leg.line as LineCode,
    isTransfer: false,
    legIndex: firstRide.index,
  });

  // Intermediate and final stations
  for (let r = 0; r < rides.length; r++) {
    const ride = rides[r];
    const isLast = r === rides.length - 1;
    const nextRide = !isLast ? rides[r + 1] : undefined;

    const toPlatform = getPlatform(ride.leg.to);
    const toStation = toPlatform ? stationForCode(ride.leg.to) : undefined;
    const isTransfer = Boolean(nextRide);

    nodes.push({
      index: nodes.length,
      stationSlug: toStation?.slug ?? ride.leg.to,
      name: toStation?.name[locale] ?? ride.leg.to,
      code: nextRide ? nextRide.leg.from : ride.leg.to,
      line: (nextRide ? nextRide.leg.line : ride.leg.line) as LineCode,
      isTransfer,
      legIndex: ride.index,
    });
  }

  return nodes;
}

export type RailNodeStatus = "done" | "current" | "next";

/**
 * Computes whether a progress rail node is done, current, or next.
 */
export function getRailNodeStatus(
  nodeIndex: number,
  totalNodes: number,
  state: CommuteState,
  currentRideIndex: number,
): RailNodeStatus {
  if (state === "finished") return "done";

  // During idle / at_platform before any boarding
  if (state === "idle" || state === "at_platform") {
    if (currentRideIndex <= 0) {
      if (nodeIndex === 0) return "current";
      return "next";
    }
  }

  // On board: the origin is done, the destination station is current (we are arriving there)
  if (state === "on_board") {
    const arrivingNodeIndex = currentRideIndex + 1;
    if (nodeIndex < arrivingNodeIndex) return "done";
    if (nodeIndex === arrivingNodeIndex) return "current";
    return "next";
  }

  // Between legs (transfer or after last alight)
  if (state === "between") {
    const currentNodeIndex = currentRideIndex;
    if (nodeIndex < currentNodeIndex) return "done";
    if (nodeIndex === currentNodeIndex) return "current";
    return "next";
  }

  if (nodeIndex < currentRideIndex) return "done";
  if (nodeIndex === currentRideIndex) return "current";
  return "next";
}

export type CatchResult = {
  catchIndex: number;
  catchType: "exact" | "tight" | "wait" | "missed";
  waitMin: number;
};

/**
 * Marks which upcoming transfer train the passenger will catch given their arrival + transfer walk time.
 */
export function findCatchTrain(trains: BoardArrival[], reachPlatformAt: number): CatchResult {
  if (!trains.length) {
    return { catchIndex: -1, catchType: "wait", waitMin: 0 };
  }

  const idx = trains.findIndex((t) => t.at >= reachPlatformAt);
  if (idx === -1) {
    // All trains on the board depart before passenger reaches platform
    return { catchIndex: -1, catchType: "missed", waitMin: 0 };
  }

  const target = trains[idx];
  const waitMs = target.at - reachPlatformAt;
  const waitMin = Math.max(0, Math.round(waitMs / MINUTE));
  const isTight = waitMs < 60_000;

  return {
    catchIndex: idx,
    catchType: isTight ? "tight" : "wait",
    waitMin,
  };
}

export type PrimaryAction = {
  kind: TapKind;
  role: "start" | "step" | "end";
  labelKey: DictKey;
  station?: string;
  line?: LineCode;
  direction?: string;
  destination?: string;
  doorTip?: string;
  secondaryKind?: TapKind;
  secondaryLabelKey?: DictKey;
};

/**
 * Determines the single primary button action (≥ 72px) that advances the trip:
 * I boarded → Got off → I boarded → Got off → At desk / Home door
 */
export function primaryActionForTrip(
  journey: { legs: Leg[]; fromPlace?: string | null; toPlace?: string | null },
  state: CommuteState,
  fromLeg: number,
  taps: { kind: string }[] = [],
  locale: Locale = "en",
): PrimaryAction {
  const rides = journey.legs
    .map((l, i) => ({ leg: l, index: i }))
    .filter((item): item is { leg: Extract<Leg, { kind: "ride" }>; index: number } => item.leg.kind === "ride");

  const endKind: TapKind = journey.toPlace === "home" ? "door" : journey.toPlace === "office" ? "desk" : "arrived";
  const endLabelKey: DictKey = journey.toPlace === "home" ? "trip.action.door" : journey.toPlace === "office" ? "trip.action.desk" : "trip.action.done";

  if (!rides.length || state === "finished") {
    return {
      kind: endKind,
      role: "end",
      labelKey: "trip.action.done",
    };
  }

  // Count completed boards and alights in current trip taps
  const boardsCount = taps.filter((t) => t.kind === "board").length;
  const alightsCount = taps.filter((t) => t.kind === "alight").length;

  // If all rides boarded and alighted: next is end place (At desk / Home door)
  if (alightsCount >= rides.length) {
    return {
      kind: endKind,
      role: "end",
      labelKey: endLabelKey,
    };
  }

  // If currently on board a ride: action is Got off for that ride
  if (state === "on_board" || boardsCount > alightsCount) {
    const currentRideIndex = Math.min(boardsCount - 1, rides.length - 1);
    const ride = rides[currentRideIndex];
    const toStation = stationForCode(ride.leg.to);
    return {
      kind: "alight",
      role: "step",
      labelKey: "trip.action.alight",
      station: ride.leg.to,
      line: ride.leg.line as LineCode,
      direction: ride.leg.direction,
      destination: toStation?.name[locale] ?? ride.leg.to,
      doorTip: ride.leg.tip,
    };
  }

  // Waiting to board (idle, at_platform, or between transfers)
  const nextRideIndex = alightsCount;
  const nextRide = rides[nextRideIndex] ?? rides[0];
  const dir = getDirection(nextRide.leg.line, nextRide.leg.direction);
  const destName = dir?.board[locale] ?? dir?.label[locale] ?? nextRide.leg.direction;

  return {
    kind: "board",
    role: "step",
    labelKey: "trip.action.board",
    station: nextRide.leg.from,
    line: nextRide.leg.line as LineCode,
    direction: nextRide.leg.direction,
    destination: destName,
    doorTip: nextRide.leg.tip,
    // When idle before leg 1, offer optional "I'm at the platform" secondary action
    secondaryKind: state === "idle" && nextRideIndex === 0 ? "at_platform" : undefined,
    secondaryLabelKey: state === "idle" && nextRideIndex === 0 ? "trip.action.platform" : undefined,
  };
}

/** Formats milliseconds as "m:ss" (or whole minutes when >= 1 hour). */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 3600) return `${Math.round(s / 60)} min`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
