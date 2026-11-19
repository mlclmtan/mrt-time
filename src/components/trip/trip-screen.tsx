"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DoorOpen, RotateCcw, Sparkles, X, Check } from "lucide-react";
import type { Leg } from "@/lib/journey/plan";
import {
  JOURNEY_CHOICE_COOKIE,
  MANUAL_CHOICE_TTL_MS,
  TRIP_DISMISSED_COOKIE,
  autoJourneyKey,
  resolveTrip,
  serializeJourneyChoice,
  type CommuteView,
  type JourneyChoice,
  type TapKind,
} from "@/lib/journey/commute";
import { clock, formatCountdownMin } from "@/lib/format";
import { LINES, getDirection, stationForCode, type LineCode } from "@/lib/network";
import { MINUTE, nowMs } from "@/lib/time";
import { randomId } from "@/lib/analytics/client";
import { UNDO_MS } from "@/lib/sightings/client";
import { localePath } from "@/lib/i18n";
import { useAnalytics } from "../analytics/analytics-provider";
import { addBreadcrumb } from "@/lib/analytics/health";
import { useI18n } from "../i18n";
import { getSnapshot, saveSnapshot, ageLabel } from "@/lib/snapshot-cache";
import { QuickEntry } from "../board/quick-entry";
import { useTapQueue } from "../boarding/tap-queue";
import {
  directionView,
  gridArrivals,
  type BoardArrival,
} from "@/lib/predict/board-view";
import {
  findCatchTrain,
  formatCountdown,
  formatToastSeconds,
  getJourneyStationRail,
  getRailNodeStatus,
  primaryActionForTrip,
  sgtClockSeconds,
} from "@/lib/journey/trip-helpers";
import type { Logged } from "../owner/owner-home";
import type { DictKey } from "@/lib/i18n";

export type TripJourney = {
  id?: number;
  key: string;
  name: string;
  fromPlace: string | null;
  toPlace?: string | null;
  legs: Leg[];
  sheltered: boolean;
};

export type TripScreenProps = {
  journeys: TripJourney[];
  initialKey?: string;
  initialChoice: JourneyChoice | null;
  initialView: CommuteView | null;
  initialDismissedAt?: number | null;
  today: Logged[];
};

type ToastState = {
  clientId: string;
  id: number | null;
  at: number;
  kind: TapKind;
  text: string;
  until: number;
  queued?: boolean;
};

const FIX_MINUTES = [1, 2, 5] as const;

export function TripScreen({
  journeys,
  initialKey,
  initialChoice,
  initialView,
  initialDismissedAt = null,
  today,
}: TripScreenProps) {
  const { t, locale } = useI18n();
  const { track, userType } = useAnalytics();
  const viewMountedAt = useRef<number | null>(null);

  useEffect(() => {
    if (viewMountedAt.current == null) viewMountedAt.current = nowMs();
  }, []);

  const [key, setKey] = useState(initialKey ?? journeys[0]?.key ?? "");
  const manual = useRef<JourneyChoice | null>(initialChoice);
  const [logged, setLogged] = useState<Logged[]>(today);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [view, setView] = useState<CommuteView | null>(
    () => initialView ?? (getSnapshot<CommuteView>(`trip:${key}`)?.data ?? null),
  );
  const [staleAt, setStaleAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => initialView?.generatedAt ?? Date.now());
  const [refresh, setRefresh] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(initialDismissedAt);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<number | null>(() =>
    initialView ? Date.now() : (getSnapshot<CommuteView>(`trip:${key}`)?.savedAt ?? null),
  );

  useEffect(() => {
    if (initialView) {
      saveSnapshot(`trip:${key}`, initialView);
    }
  }, [key, initialView]);

  // Sheets
  const [screenSaysOpen, setScreenSaysOpen] = useState(false);
  const [wrongTimeOpen, setWrongTimeOpen] = useState(false);

  const journey = journeys.find((j) => j.key === key) ?? journeys[0];
  const mine = useMemo(
    () => logged.filter((e) => !e.journeyKey || e.journeyKey === key).sort((a, b) => a.at - b.at),
    [logged, key],
  );
  const shownView = view && view.journeyKey === key ? view : null;

  // Resolve current trip state
  const minute = Math.floor(now / MINUTE) * MINUTE;
  const serverFinishedAt = shownView?.progress.state === "finished" ? shownView.progress.arrivedAt ?? null : null;
  const trip = useMemo(
    () => (journey && minute ? resolveTrip(journey, mine, minute, { dismissedAt, serverFinishedAt }) : null),
    [journey, mine, minute, dismissedAt, serverFinishedAt],
  );

  const progress = trip?.progress ?? shownView?.progress ?? { state: "idle" as const, fromLeg: 0, startAt: now };
  const tapStart = progress.state === "on_board" || progress.state === "between" || progress.state === "finished" ? progress.startAt : 0;
  const requestKey = `${key}|${progress.fromLeg}|${progress.state}|${tapStart}`;
  const servedKey = useRef(
    initialView
      ? `${initialView.journeyKey}|${initialView.progress.fromLeg}|${initialView.progress.state}|${["on_board", "between", "finished"].includes(initialView.progress.state) ? initialView.progress.startAt : 0}`
      : "",
  );

  const queue = useTapQueue(useCallback(() => setRefresh((n) => n + 1), []));

  // 1-second countdown tick and 30s auto journey switch
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    const auto = setInterval(() => {
      const k = autoJourneyKey(journeys, Date.now(), manual.current);
      if (k) setKey(k);
    }, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      clearInterval(auto);
    };
  }, [journeys]);

  // 30-second commute refresh and on visibility change
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const [, fromLeg, state] = requestKey.split("|");
    const load = async () => {
      const q = new URLSearchParams({ journey: key, fromLeg, state });
      if (tapStart) q.set("startAt", String(tapStart));
      setIsRevalidating(true);
      try {
        const res = await fetch(`/api/commute?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as CommuteView;
        if (stopped) return;
        setView(body);
        setStaleAt(null);
        saveSnapshot(`trip:${key}`, body);
        setSnapshotSavedAt(Date.now());
      } catch {
        if (!stopped) setStaleAt(Date.now());
      } finally {
        if (!stopped) setIsRevalidating(false);
      }
    };

    const skipFirst = refresh === 0 && servedKey.current === requestKey;
    servedKey.current = "";
    const first = skipFirst ? null : setTimeout(() => void load(), 0);
    const poll = setInterval(() => document.visibilityState === "visible" && void load(), 30_000);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (first) clearTimeout(first);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, requestKey, tapStart, refresh]);

  // Toast countdown timer
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), Math.max(0, toast.until - Date.now()));
    return () => clearTimeout(timer);
  }, [toast]);

  // Journey switch
  const choose = useCallback((k: string) => {
    const choice = { key: k, at: Date.now() };
    manual.current = choice;
    document.cookie = `${JOURNEY_CHOICE_COOKIE}=${serializeJourneyChoice(choice)}; max-age=${MANUAL_CHOICE_TTL_MS / 1000}; path=/; samesite=lax`;
    setKey(k);
  }, []);

  // Sync today's taps from server
  const reload = useCallback(async () => {
    const res = await fetch("/api/trip-events", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { events: Logged[] };
      setLogged(body.events);
    }
    setRefresh((n) => n + 1);
  }, []);

  // Determine Primary and Secondary actions
  const primaryAction = useMemo(() => {
    if (!journey) {
      return { kind: "done" as TapKind, role: "end" as const, labelKey: "trip.action.done" as const };
    }
    return primaryActionForTrip(journey, progress.state, progress.fromLeg, trip?.taps ?? mine, locale);
  }, [journey, progress.state, progress.fromLeg, trip?.taps, mine, locale]);

  const dismiss = useCallback(() => {
    const last = trip?.lastTapAt;
    if (last == null) return;
    document.cookie = `${TRIP_DISMISSED_COOKIE}=${Math.round(last)}; max-age=${24 * 3600}; path=/; samesite=lax`;
    setDismissedAt(last);
  }, [trip?.lastTapAt]);

  // Logging a tap
  async function logTap(kind: TapKind, overrideAt?: number) {
    if (!journey) return;
    if (primaryAction.role === "end") {
      dismiss();
    }
    const tapped = nowMs();
    const at = overrideAt ?? tapped;
    const clientId = randomId();

    const usesPlatform = kind === "board" || kind === "alight" || kind === "at_platform";
    const stationCode = usesPlatform ? primaryAction.station : undefined;
    const lineCode = usesPlatform ? primaryAction.line : undefined;
    const directionKey = usesPlatform ? primaryAction.direction : undefined;

    // Optimistic state update
    const newEvent: Logged = {
      id: -Date.now(),
      kind,
      at,
      station: stationCode ?? null,
      line: lineCode ?? null,
      direction: directionKey ?? null,
      journeyKey: key,
      clientId,
    };
    setLogged((prev) => [...prev, newEvent]);
    setNow(tapped);

    // Track analytics
    track("log_trip_event", {
      kind,
      ...(stationCode ? { station: stationCode, line: lineCode as LineCode } : {}),
    });

    // Create toast with seconds
    const toastText = formatToastSeconds(kind, at, t);
    setToast({
      clientId,
      id: null,
      at,
      kind,
      text: toastText,
      until: tapped + UNDO_MS,
    });

    const body = {
      clientId,
      kind,
      at: new Date(at).toISOString(),
      ...(stationCode ? { station: stationCode, line: lineCode } : {}),
      ...(directionKey ? { direction: directionKey } : {}),
      journeyKey: key,
      timeSource: "now" as const,
    };

    const res = await fetch("/api/trip-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);

    if (!res || !res.ok) {
      // Save offline in queue
      queue.enqueue("/api/trip-events", body);
      setToast((curr) => (curr ? { ...curr, queued: true } : null));
      return;
    }

    const saved = (await res.json().catch(() => null)) as { id?: number | null } | null;
    if (saved?.id) {
      setToast((curr) => (curr ? { ...curr, id: saved.id ?? null } : null));
    }
    await reload();
  }

  // Undo
  async function handleUndo(clientIdToUndo?: string) {
    track("tap_undo", {});
    const id = clientIdToUndo ?? toast?.clientId;
    if (!id) return;
    setToast(null);
    setWrongTimeOpen(false);
    setLogged((prev) => prev.filter((e) => e.clientId !== id));
    await fetch(`/api/trip-events?clientId=${id}`, { method: "DELETE" }).catch(() => null);
    await reload();
  }

  // Adjust time by -1, -2, -5 minutes
  async function handleFixTime(minutes: number, targetEventId?: number | null) {
    track("tap_correction", { minutes: (-minutes) as -1 | -2 | -5 });
    const id = targetEventId ?? toast?.id;
    const currentAt = toast?.at ?? (mine.length ? mine[mine.length - 1].at : now);
    const newAt = currentAt - minutes * MINUTE;

    if (toast) {
      setToast({
        ...toast,
        at: newAt,
        text: formatToastSeconds(toast.kind, newAt, t),
        until: now + UNDO_MS,
      });
    }

    // Optimistically update logged array
    setLogged((prev) =>
      prev.map((e) => (id != null && e.id === id ? { ...e, at: newAt } : e.clientId === toast?.clientId ? { ...e, at: newAt } : e)),
    );

    if (id != null && id > 0) {
      await fetch("/api/trip-events", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, at: new Date(newAt).toISOString() }),
      }).catch(() => null);
    }
    await reload();
  }

  // Station rail
  const railNodes = useMemo(() => {
    return journey ? getJourneyStationRail(journey.legs, locale) : [];
  }, [journey, locale]);

  // Rides list
  const rides = useMemo(() => {
    if (!journey) return [];
    return journey.legs
      .map((l, i) => ({ leg: l, index: i }))
      .filter((item): item is { leg: Extract<Leg, { kind: "ride" }>; index: number } => item.leg.kind === "ride");
  }, [journey]);

  // Current ride index
  const boardsCount = useMemo(() => mine.filter((t) => t.kind === "board").length, [mine]);
  const alightsCount = useMemo(() => mine.filter((t) => t.kind === "alight").length, [mine]);
  const currentRideIndex = progress.state === "on_board" ? Math.max(0, boardsCount - 1) : Math.min(alightsCount, rides.length - 1);
  const currentRide = rides[currentRideIndex]?.leg;

  // Rail status for top bar
  const railStatus = useMemo(() => {
    return railNodes.map((_, idx) => getRailNodeStatus(idx, railNodes.length, progress.state, currentRideIndex));
  }, [railNodes, progress.state, currentRideIndex]);

  // Active platform for "Now" card
  const currentPlatformCode = primaryAction.station ?? currentRide?.from ?? "EW17";
  const currentLine = (primaryAction.line ?? currentRide?.line ?? "EWL") as LineCode;
  const currentDirection = primaryAction.direction ?? currentRide?.direction ?? "";
  const currentStationObj = currentPlatformCode ? stationForCode(currentPlatformCode) : undefined;
  const currentDirObj = getDirection(currentLine, currentDirection);
  const currentDest = currentDirObj?.board[locale] ?? currentDirObj?.label[locale] ?? currentDirection;

  // Board arrivals for current platform
  const currentPredKey = `${currentPlatformCode}|${currentDirection}`;
  const currentPred = shownView?.predictions?.[currentPredKey];
  const currentArrivals = useMemo<BoardArrival[]>(() => {
    if (currentPred) {
      const dv = directionView(currentPred, now, currentLine);
      if (dv.state !== "closed") return dv.arrivals;
    }
    const headway = 5;
    const gridTimes = gridArrivals(headway, now, currentLine, 3);
    return gridTimes.map((at) => ({
      at,
      clock: clock(at),
      inMin: Math.max(0, Math.floor((at - now) / MINUTE)),
      plusMinus: null,
    }));
  }, [currentPred, now, currentLine]);

  const nextArrival = currentArrivals[0];
  const thenArrivals = currentArrivals.slice(1, 3);

  // Transfer train prediction when on board
  const transferInfo = useMemo(() => {
    if (progress.state !== "on_board" || currentRideIndex >= rides.length - 1) {
      return null;
    }
    const nextR = rides[currentRideIndex + 1]?.leg;
    if (!nextR) return null;

    // Last board time
    const lastBoardAt = mine.slice().reverse().find((e) => e.kind === "board")?.at ?? now;
    const rideMin = currentRide?.rideMin ?? 4;
    const arriveNextAt = lastBoardAt + rideMin * MINUTE;

    // Transfer leg walk minutes
    const intermediateLegs = journey.legs.slice(
      rides[currentRideIndex].index + 1,
      rides[currentRideIndex + 1].index,
    );
    const transferLeg = intermediateLegs.find(
      (l): l is Extract<Leg, { kind: "transfer" }> => l.kind === "transfer",
    );
    const transferMin = transferLeg?.min ?? 4;
    const reachPlatformAt = Math.max(arriveNextAt, now) + transferMin * MINUTE;

    const nextStationObj = stationForCode(nextR.from);
    const nextDirObj = getDirection(nextR.line, nextR.direction);
    const nextDest = nextDirObj?.board[locale] ?? nextDirObj?.label[locale] ?? nextR.direction;

    // Load next platform prediction
    const predKey = `${nextR.from}|${nextR.direction}`;
    const pred = shownView?.predictions?.[predKey];
    const dirView = pred
      ? directionView(pred, now, nextR.line)
      : {
          state: "estimate" as const,
          arrivals: gridArrivals(5, now, nextR.line, 3).map((at) => ({
            at,
            clock: clock(at),
            inMin: Math.max(0, Math.floor((at - now) / MINUTE)),
            plusMinus: null,
          })),
        };

    const trains: BoardArrival[] = dirView.state !== "closed" ? dirView.arrivals.slice(0, 3) : [];
    const catchResult = findCatchTrain(trains, reachPlatformAt);

    return {
      nextRide: nextR,
      platformCode: nextR.from,
      line: nextR.line as LineCode,
      direction: nextR.direction,
      destination: nextDest,
      stationName: nextStationObj?.name[locale] ?? nextR.from,
      arriveNextAt,
      reachPlatformAt,
      transferMin,
      trains,
      catchResult,
    };
  }, [progress.state, currentRideIndex, rides, mine, now, currentRide, journey, shownView?.predictions, locale]);

  // Pre-departure "Leave in m:ss"
  const firstLeaveRow = shownView?.rows[0];
  const leaveTimeMs = firstLeaveRow ? firstLeaveRow.leaveAt - now : null;

  // Door tip for current leg
  const doorTip = currentRide?.tip ?? primaryAction.doorTip;

  // Catch hint for transfer leg
  const catchHint = useMemo(() => {
    const ridesList = shownView?.leaveNow?.rides;
    if (currentRideIndex > 0 && ridesList?.length) {
      const r =
        ridesList.find((ride) => ride.from === currentPlatformCode && ride.line === currentLine) ??
        ridesList[0];
      if (r?.catch === "tight") return { text: t("trip.catch.tight"), tight: true };
      if (r?.catch === "wait") return { text: t("trip.catch.waitMin", { n: r.waitMin }), tight: false };
      if (r?.catch === "likely") return { text: t("trip.catch.likely"), tight: false };
      if (r?.catch === "easy") return { text: t("trip.catch.easy"), tight: false };
    }
    return null;
  }, [currentRideIndex, shownView?.leaveNow?.rides, currentPlatformCode, currentLine, t]);

  const lastBoardAt = useMemo(
    () => mine.slice().reverse().find((e) => e.kind === "board")?.at ?? now,
    [mine, now],
  );
  const finalDestStationCode = currentRide?.to ?? currentPlatformCode;
  const finalDestStationObj = finalDestStationCode ? stationForCode(finalDestStationCode) : undefined;
  const finalDestStationName = finalDestStationObj?.name[locale] ?? finalDestStationCode;
  const finalArriveAt = lastBoardAt + (currentRide?.rideMin ?? 4) * MINUTE;

  const latestLoggedEvent = mine.length ? mine[mine.length - 1] : null;

  if (!journey) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50dvh] text-center p-6 space-y-4">
        <p className="text-lg font-semibold text-muted">{t("trip.noJourneys")}</p>
        <Link
          href={localePath(locale, "/plan")}
          className="btn btn-primary h-12 min-h-[48px] px-6 text-base font-bold rounded-xl flex items-center justify-center"
        >
          {t("trip.planLink")}
        </Link>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0 justify-between max-w-lg mx-auto w-full py-1 sm:py-2 select-none gap-2"
      data-trip-screen
      data-trip-state={progress.state}
    >
      {/* 1. TOP SECTION: Journey picker + 44px Progress rail */}
      <div className="flex-none space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            {t("trip.title")}
          </span>
          <div className="flex items-center gap-2">
            {isRevalidating && (
              <span className="text-xs font-medium text-muted animate-pulse">
                {t("snap.updating")}
              </span>
            )}
            {!isRevalidating && snapshotSavedAt && ageLabel(snapshotSavedAt, now, locale) && (
              <span className="chip bg-warn/15 text-warn text-[11px] px-2 py-0.5">
                {ageLabel(snapshotSavedAt, now, locale)}
              </span>
            )}
            {staleAt && (
              <span className="chip bg-warn/15 text-warn text-[11px] px-2 py-0.5">
                {t("trip.now.offline", { time: clock(staleAt) })}
              </span>
            )}
            <select
              className="field w-auto min-h-[44px] py-1 px-2.5 text-xs font-semibold rounded-lg border border-line bg-panel text-foreground"
              value={key}
              onChange={(e) => choose(e.target.value)}
              aria-label={t("owner.journeys")}
            >
              {journeys.map((j) => (
                <option key={j.key} value={j.key}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 44px Station Progress Rail */}
        <div
          className="flex items-center justify-between h-11 px-2 rounded-xl bg-panel-2 border border-line relative"
          role="region"
          aria-label={t("trip.rail.station")}
        >
          {railNodes.map((node, i) => {
            const status = railStatus[i];
            const isLast = i === railNodes.length - 1;
            const lineColor = LINES[node.line]?.color ?? "#888";

            return (
              <div key={`${node.code}-${i}`} className="flex items-center flex-1 last:flex-none">
                {/* Node icon & label */}
                <button
                  type="button"
                  onClick={() => setWrongTimeOpen(true)}
                  className="flex flex-col items-center justify-center min-w-[44px] min-h-[44px] px-1 cursor-pointer focus:outline-none"
                  aria-label={`${node.name} (${status})`}
                >
                  <div className="flex items-center gap-1">
                    <div
                      className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-transform ${
                        status === "done"
                          ? "bg-go text-white"
                          : status === "current"
                            ? "bg-led text-black ring-4 ring-led/30 scale-110"
                            : "border-2 border-line bg-panel text-transparent"
                      }`}
                    >
                      {status === "done" && <Check size={9} strokeWidth={3} />}
                    </div>
                    <span
                      className="chip text-[9px] font-bold text-white rounded px-1 leading-tight"
                      style={{ background: lineColor }}
                    >
                      {node.code}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] mt-0.5 truncate max-w-[70px] ${
                      status === "current" ? "font-bold text-foreground" : "text-muted"
                    }`}
                  >
                    {node.name}
                  </span>
                </button>

                {/* Connecting Rail Line */}
                {!isLast && (
                  <div className="flex-1 flex items-center px-1">
                    <div
                      className="h-1 w-full rounded-full transition-colors opacity-75"
                      style={{
                        backgroundColor: status === "done" ? lineColor : "var(--line)",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. MIDDLE "NOW" CARD FOR CURRENT PLATFORM */}
      <div className="flex-1 min-h-0 flex flex-col my-1 sm:my-2">
        <div className="panel rise p-3.5 sm:p-4 rounded-2xl flex flex-col justify-between border border-line flex-1 min-h-0">
          {/* A. If ON BOARD a leg with a transfer: SHOW ARRIVAL + TRANSFER BOARD */}
          {progress.state === "on_board" && transferInfo ? (
            <div className="space-y-3">
              {/* Header: Next stop arrival */}
              <div className="flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="chip px-1.5 py-0.5 text-xs font-bold text-white rounded"
                    style={{ background: LINES[currentLine]?.color }}
                  >
                    {currentLine}
                  </span>
                  <span className="text-sm font-semibold text-muted">
                    {t("trip.now.onBoard", { dest: transferInfo.stationName })}
                  </span>
                </div>
                <span className="text-xl font-bold tabular text-accent">
                  {formatCountdown(Math.max(0, transferInfo.arriveNextAt - now))}
                </span>
              </div>

              <div className="text-2xl font-bold tabular led text-led">
                {t("trip.now.arriving", {
                  station: transferInfo.stationName,
                  time: clock(transferInfo.arriveNextAt),
                })}
              </div>

              {/* Transfer platform next 3 trains */}
              <div className="pt-2 border-t border-line space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="chip px-1 text-[10px] font-bold text-white rounded"
                      style={{ background: LINES[transferInfo.line as LineCode]?.color }}
                    >
                      {transferInfo.line}
                    </span>
                    <span className="font-semibold">
                      {transferInfo.platformCode} → {transferInfo.destination}
                    </span>
                  </div>
                  <span className="text-muted text-[11px]">
                    {t("trip.now.transferWalk", {
                      min: transferInfo.transferMin,
                      platform: transferInfo.platformCode,
                      time: clock(transferInfo.reachPlatformAt),
                    })}
                  </span>
                </div>

                {/* 3 Transfer Trains with Catch indication */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {transferInfo.trains.map((train: BoardArrival, idx: number) => {
                    const isTarget = idx === transferInfo.catchResult.catchIndex;
                    const isMissed =
                      transferInfo.catchResult.catchType === "missed" ||
                      (transferInfo.catchResult.catchIndex !== -1 && idx < transferInfo.catchResult.catchIndex);

                    return (
                      <div
                        key={`${train.at}-${idx}`}
                        className={`p-2 rounded-xl border flex flex-col items-center justify-center transition-colors ${
                          isTarget
                            ? "bg-go/15 border-go text-go ring-2 ring-go/30"
                            : isMissed
                              ? "bg-panel-2 border-line text-muted opacity-50"
                              : "bg-panel-2 border-line text-foreground"
                        }`}
                      >
                        <span className="text-lg font-bold tabular led">
                          {train.clock}
                        </span>
                        <span
                          className={`text-[11px] font-semibold mt-0.5 ${
                            isTarget
                              ? "text-go font-bold"
                              : isMissed
                                ? "text-muted line-through"
                                : "text-muted"
                          }`}
                        >
                          {isTarget
                            ? transferInfo.catchResult.catchType === "tight"
                              ? t("trip.catch.tight")
                              : t("trip.catch.target")
                            : isMissed
                              ? t("trip.catch.missed")
                              : t("trip.catch.later")}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Transfer leg door tip */}
                {transferInfo.nextRide.tip && (
                  <p className="flex items-center gap-1.5 text-xs text-led pt-0.5">
                    <DoorOpen size={15} className="shrink-0" />
                    <span>
                      {t("trip.now.doors")}: {transferInfo.nextRide.tip}
                    </span>
                  </p>
                )}
              </div>
            </div>
          ) : progress.state === "on_board" && !transferInfo ? (
            /* B. ON BOARD single-leg or final leg */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="chip px-2 py-0.5 text-xs font-bold text-white rounded"
                    style={{ background: LINES[currentLine]?.color }}
                  >
                    {currentLine}
                  </span>
                  <span className="text-base font-semibold">
                    {t("trip.now.onBoard", { dest: finalDestStationName })}
                  </span>
                </div>
                <span className="text-xl font-bold tabular text-accent">
                  {formatCountdown(Math.max(0, finalArriveAt - now))}
                </span>
              </div>

              <div className="py-2">
                <span className="text-xs uppercase font-semibold text-muted tracking-wider">
                  {t("trip.now.next")}
                </span>
                <div className="text-3xl font-bold tabular led text-led">
                  {t("trip.now.arriving", {
                    station: finalDestStationName,
                    time: clock(finalArriveAt),
                  })}
                </div>
              </div>

              {doorTip && (
                <p className="flex items-center gap-1.5 text-[17px] font-medium leading-snug text-led">
                  <DoorOpen size={18} className="shrink-0" />
                  <span>
                    {t("trip.now.doors")}: {doorTip}
                  </span>
                </p>
              )}
            </div>
          ) : progress.state === "finished" ? (
            /* C. TRIP COMPLETE / FINISHED */
            <div className="space-y-4 py-6 text-center">
              <div className="w-14 h-14 rounded-full bg-go/15 text-go flex items-center justify-center mx-auto">
                <Check size={32} strokeWidth={3} />
              </div>
              <div className="text-2xl font-bold text-foreground">
                {t("trip.now.arrived")}
              </div>
              <p className="text-base text-muted">
                {latestLoggedEvent ? formatToastSeconds(latestLoggedEvent.kind as TapKind, latestLoggedEvent.at, t) : ""}
              </p>
            </div>
          ) : (
            /* D. WAITING / AT PLATFORM / IDLE / BETWEEN TRANSFERS */
            <div className="space-y-3">
              {/* Platform Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="chip px-2 py-0.5 text-xs font-bold text-white rounded"
                    style={{ background: LINES[currentLine]?.color }}
                  >
                    {currentLine}
                  </span>
                  <span className="text-base font-bold text-foreground">
                    {currentPlatformCode} · {currentStationObj?.name[locale] ?? currentPlatformCode}
                  </span>
                </div>
                <span className="text-sm text-muted">
                  {t("board.towards")} {currentDest}
                </span>
              </div>

              {/* Pre-departure Leave In Header when idle */}
              {progress.state === "idle" && leaveTimeMs != null && (
                <div className="flex items-center justify-between text-sm font-semibold text-accent">
                  <span>
                    {leaveTimeMs > 30_000
                      ? t("trip.now.leaveIn", { time: formatCountdown(leaveTimeMs) })
                      : leaveTimeMs >= 0
                        ? t("trip.now.leaveNow")
                        : t("trip.now.missed", { time: nextArrival?.clock ?? "" })}
                  </span>
                  {firstLeaveRow && (
                    <span className="text-xs text-muted font-normal tabular">
                      {t("trip.now.leaveBy", { time: clock(firstLeaveRow.leaveAt) })}
                    </span>
                  )}
                </div>
              )}

              {/* NEXT Train: BIG "N min" (≥ 32px, bold, LED style) + small clock (≥ 15px) */}
              <div className="flex items-baseline justify-between py-1">
                <div>
                  <span className="text-xs uppercase font-semibold text-muted tracking-wider block">
                    {t("trip.now.next")}
                  </span>
                  <span className="text-5xl font-black tabular led text-led leading-none">
                    {nextArrival
                      ? formatCountdownMin(Math.max(0, nextArrival.at - now), locale)
                      : "—"}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-[17px] font-semibold tabular text-muted block">
                    {nextArrival?.clock ?? "—"}
                  </span>
                  {nextArrival?.plusMinus != null && (
                    <span className="text-xs text-muted tabular">
                      ±{nextArrival.plusMinus} min
                    </span>
                  )}
                </div>
              </div>

              {/* Next 2 Times (≥ 17px): "in 10 min · 15:33" */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line">
                <span className="text-xs uppercase font-semibold text-muted tracking-wider">
                  {t("trip.now.then")}
                </span>
                <div className="flex items-center gap-3 text-[17px] font-semibold tabular led text-muted">
                  {thenArrivals.slice(0, 2).map((arr: BoardArrival, i: number) => {
                    const arrMs = Math.max(0, arr.at - now);
                    const arrMin = Math.floor(arrMs / 60_000);
                    const inText = arrMin === 0 ? t("board.due") : t("board.in", { n: arrMin });
                    return (
                      <span key={i} className="hover:text-foreground">
                        {inText} · {arr.clock}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Door tip (≥ 17px) & Catch hint */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {doorTip ? (
                  <p className="flex items-center gap-1.5 text-[17px] font-medium leading-snug text-led">
                    <DoorOpen size={18} className="shrink-0" />
                    <span>
                      {t("trip.now.doors")}: {doorTip}
                    </span>
                  </p>
                ) : <div />}

                {catchHint && (
                  <span
                    className={`text-[17px] font-semibold px-2.5 py-0.5 rounded-lg ${
                      catchHint.tight
                        ? "bg-bad/15 text-bad"
                        : "bg-go/15 text-go"
                    }`}
                  >
                    {catchHint.text}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. BOTTOM THIRD: Primary Button (≥ 72px) + Secondary Row (≥ 48px) */}
      <div className="flex-none space-y-2">
        {/* ONE FULL-WIDTH PRIMARY BUTTON ≥ 72px */}
        <button
          type="button"
          onClick={() => {
            const kind = primaryAction.kind;
            const step: "at_platform" | "boarded" | "alighted" | "arrived" =
              kind === "board"
                ? "boarded"
                : kind === "alight"
                  ? "alighted"
                  : kind === "at_platform"
                    ? "at_platform"
                    : "arrived";
            const journey_type: "owner_saved" | "public" = userType === "owner" ? "owner_saved" : "public";
            const ms_since_view = Math.max(0, viewMountedAt.current != null ? now - viewMountedAt.current : 0);
            track("trip_tap", { step, journey_type, ms_since_view });
            addBreadcrumb(`tap:${step}`);
            void logTap(kind);
          }}
          className="btn btn-primary w-full h-[72px] min-h-[72px] text-xl font-bold rounded-2xl shadow-lg ring-4 ring-led/30 flex items-center justify-center gap-3 cursor-pointer"
        >
          <Check size={26} strokeWidth={3} className="shrink-0" />
          <span>{t(primaryAction.labelKey)}</span>
          {primaryAction.destination && (
            <span className="text-sm font-normal opacity-80 truncate max-w-[140px]">
              · {primaryAction.destination}
            </span>
          )}
        </button>

        {/* SECONDARY ROW ≥ 48px */}
        <div className="grid grid-cols-2 gap-2">
          {/* Button 1: "Screen says…" */}
          <button
            type="button"
            onClick={() => setScreenSaysOpen(true)}
            className="btn btn-secondary h-12 min-h-[48px] text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5"
          >
            <Sparkles size={16} />
            <span>{t("trip.action.screenSays")}</span>
          </button>

          {/* Button 2: "Undo / Wrong time?" or "I'm at the platform" */}
          {primaryAction.secondaryKind ? (
            <button
              type="button"
              onClick={() => void logTap(primaryAction.secondaryKind!)}
              className="btn btn-secondary h-12 min-h-[48px] text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5"
            >
              <span>{t(primaryAction.secondaryLabelKey!)}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setWrongTimeOpen(true)}
              className="btn btn-secondary h-12 min-h-[48px] text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={16} />
              <span>{t("trip.action.wrongTime")}</span>
            </button>
          )}
        </div>
      </div>

      {/* 4. FLOATING UNDO / CORRECTION TOAST (10s) */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-16 inset-x-4 max-w-lg mx-auto z-50 rounded-2xl bg-panel border border-line shadow-2xl p-3 space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-200"
        >
          <div className="flex items-center justify-between gap-3">
            <span className={`text-sm font-bold ${toast.queued ? "text-warn" : "text-foreground"}`}>
              {toast.text}
            </span>
            <button
              type="button"
              onClick={() => void handleUndo()}
              className="min-h-[44px] min-w-[44px] px-3 font-bold text-sm text-led hover:text-led/80 active:scale-95 flex items-center justify-center"
            >
              {t("trip.action.undo")}
            </button>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-line text-xs">
            <span className="text-muted">{t("trip.action.fixTime")}</span>
            <div className="flex items-center gap-2">
              {FIX_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void handleFixTime(m)}
                  className="min-h-[44px] min-w-[50px] px-2 py-1 rounded-lg border border-line bg-panel-2 font-semibold text-xs tabular flex items-center justify-center active:scale-95"
                >
                  {t("trip.action.minusMin", { n: m })}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 5. "SCREEN SAYS…" MODAL SHEET */}
      {screenSaysOpen && (
        <div
          role="dialog"
          aria-labelledby="screen-says-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
        >
          <div className="panel w-full max-w-lg rounded-2xl p-4 max-h-[90dvh] overflow-y-auto space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-line">
              <h3 id="screen-says-title" className="text-base font-bold">
                {t("trip.action.screenSays")}
              </h3>
              <button
                type="button"
                onClick={() => setScreenSaysOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted hover:text-foreground"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <QuickEntry
              key={`${currentPlatformCode}-${currentDirection}`}
              station={currentPlatformCode}
              line={currentLine}
              direction={currentDirection}
              destination={currentDest}
              startOpen={true}
              onSaved={() => {
                setScreenSaysOpen(false);
                setRefresh((n) => n + 1);
              }}
              onUndone={() => {
                setScreenSaysOpen(false);
                setRefresh((n) => n + 1);
              }}
            />
          </div>
        </div>
      )}

      {/* 6. "UNDO / WRONG TIME?" MODAL SHEET */}
      {wrongTimeOpen && (
        <div
          role="dialog"
          aria-labelledby="wrong-time-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
        >
          <div className="panel w-full max-w-lg rounded-2xl p-4 max-h-[90dvh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-line">
              <h3 id="wrong-time-title" className="text-base font-bold">
                {t("trip.action.wrongTime")}
              </h3>
              <button
                type="button"
                onClick={() => setWrongTimeOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted hover:text-foreground"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {latestLoggedEvent ? (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-panel-2 border border-line flex items-center justify-between">
                  <div>
                    <span className="text-sm font-bold block">
                      {t(`trip.action.${latestLoggedEvent.kind}` as DictKey)}
                    </span>
                    <span className="text-xs text-muted tabular">
                      {sgtClockSeconds(latestLoggedEvent.at)}
                      {latestLoggedEvent.station ? ` · ${latestLoggedEvent.station}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleUndo(latestLoggedEvent.clientId)}
                    className="min-h-[44px] px-4 font-bold text-sm text-bad bg-bad/10 rounded-lg hover:bg-bad/20 active:scale-95 flex items-center justify-center"
                  >
                    {t("trip.action.undo")}
                  </button>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs text-muted">{t("trip.action.fixTime")}</span>
                  <div className="grid grid-cols-3 gap-2">
                    {FIX_MINUTES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void handleFixTime(m, latestLoggedEvent.id)}
                        className="btn btn-secondary h-12 min-h-[48px] text-sm font-semibold rounded-xl tabular flex items-center justify-center active:scale-95"
                      >
                        {t("trip.action.minusMin", { n: m })}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted text-center py-4">
                {t("trip.noJourneys")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
