"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { journeySteps, nextStepIndex, type Step } from "@/lib/journey/steps";
import type { Leg } from "@/lib/journey/plan";
import {
  JOURNEY_CHOICE_COOKIE,
  MANUAL_CHOICE_TTL_MS,
  autoJourneyKey,
  commuteProgress,
  journeyEnds,
  serializeJourneyChoice,
  type CommuteView,
  type JourneyChoice,
} from "@/lib/journey/commute";
import { clock } from "@/lib/format";
import { getDirection, getPlatform, stationForCode, type LineCode } from "@/lib/network";
import { MINUTE, nowMs } from "@/lib/time";
import { randomId } from "@/lib/analytics/client";
import { NOW_CHOICE, UNDO_MS, minutesBack, resolveTime, timeSourceOf, type TimeChoice } from "@/lib/sightings/client";
import type { DictKey } from "@/lib/i18n";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { QuickEntry } from "../board/quick-entry";
import { Planner } from "../plan/planner";
import { VersionFooter } from "../version-footer";
import { TimeChips } from "../boarding/time-chips";
import { PlatformPicker, type PlatformChoice } from "../boarding/platform-picker";
import { useTapQueue } from "../boarding/tap-queue";
import { CommutePanel } from "./commute-panel";
import { TripTimeline, kindLabel, type TimelineItem } from "./trip-timeline";

type Journey = { key: string; name: string; fromPlace: string | null; toPlace?: string | null; legs: Leg[]; sheltered: boolean };
export type Logged = TimelineItem & { journeyKey?: string | null; clientId?: string };
type TapKind = "door" | "desk" | "at_platform" | "board" | "alight" | "tap_out" | "arrived";
type Toast = { clientId: string; id: number | null; at: number; kind: TapKind; text: string; until: number; queued?: boolean };

const POLL_MS = 60_000;
/** "Wrong time?" in the toast moves the tap back this many minutes (shown as clock times). */
const FIX_MINUTES = [1, 2, 5] as const;
/** "home" → the home door, "office" → the desk (journey ends for commute stats). */
const placeKind = (place: string | null | undefined): TapKind => (place === "home" ? "door" : place === "office" ? "desk" : "arrived");

/** The journey-aware next step as a tap: the arrival step means the place you are going to. */
export function nextTapKind(next: Step | undefined, finished: boolean, endKind: TapKind): TapKind | null {
  if (finished) return endKind;
  if (!next) return null;
  return next.kind === "arrived" ? endKind : next.kind;
}

export function OwnerHome({
  journeys,
  initialKey,
  initialChoice,
  initialView,
  today,
  stations,
  remindersAvailable,
  defaultTime,
}: {
  journeys: Journey[];
  initialKey?: string;
  initialChoice: JourneyChoice | null;
  initialView: CommuteView | null;
  today: Logged[];
  stations: { slug: string; name: string }[];
  remindersAvailable: boolean;
  defaultTime: string;
}) {
  const { t, locale, href } = useI18n();
  const { track } = useAnalytics();
  const [key, setKey] = useState(initialKey ?? journeys[0]?.key ?? "");
  const manual = useRef<JourneyChoice | null>(initialChoice);
  const [logged, setLogged] = useState<Logged[]>(today);
  const [toast, setToast] = useState<Toast | null>(null);
  const [view, setView] = useState<CommuteView | null>(initialView);
  const [staleAt, setStaleAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => initialView?.generatedAt ?? 0);
  const [refresh, setRefresh] = useState(0);
  const [time, setTime] = useState<TimeChoice>(NOW_CHOICE);
  const [override, setOverride] = useState<PlatformChoice | null>(null);
  /** "Arrived ~10:25?" dismissed for the trip whose last tap was at this time. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const journey = journeys.find((j) => j.key === key);
  const steps = useMemo(() => (journey ? journeySteps(journey.legs) : []), [journey]);
  const mine = useMemo(() => logged.filter((e) => !e.journeyKey || e.journeyKey === key).sort((a, b) => a.at - b.at), [logged, key]);
  const nextIdx = nextStepIndex(steps, mine);
  const next = steps[nextIdx];

  // Where the owner is along the journey; minute-granular so the request key stays stable.
  const minute = Math.floor(now / MINUTE) * MINUTE;
  const progress = useMemo(
    () => (journey && minute ? commuteProgress(journey.legs, mine, minute) : (initialView?.progress ?? { state: "idle" as const, fromLeg: 0, startAt: 0 })),
    [journey, mine, minute, initialView],
  );
  // Moving: the rest of the trip is planned from the tap times (startAt), not from now.
  const tapStart = progress.state !== "idle" && progress.state !== "at_platform" && progress.state !== "finished" ? progress.startAt : 0;
  const requestKey = `${key}|${progress.fromLeg}|${progress.state}|${tapStart}`;
  const servedKey = useRef(
    initialView ? `${initialView.journeyKey}|${initialView.progress.fromLeg}|${initialView.progress.state}|${initialView.progress.state === "on_board" || initialView.progress.state === "between" ? initialView.progress.startAt : 0}` : "",
  );

  const queue = useTapQueue(useCallback(() => setRefresh((n) => n + 1), []));

  // Clock + time-of-day journey switch (a manual pick holds for 2 h).
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    const auto = setInterval(() => {
      const k = autoJourneyKey(journeys, Date.now(), manual.current);
      if (k) setKey(k);
    }, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      clearInterval(auto);
    };
  }, [journeys]);

  // Recompute on journey/progress change, after taps, edits and readings, and every minute.
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const [, fromLeg, state] = requestKey.split("|");
    const load = async () => {
      const q = new URLSearchParams({ journey: key, fromLeg, state });
      if (tapStart) q.set("startAt", String(tapStart));
      try {
        const res = await fetch(`/api/commute?${q}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as CommuteView;
        if (stopped) return;
        setView(body);
        setStaleAt(null);
      } catch {
        if (!stopped) setStaleAt(Date.now());
      }
    };
    // The server already rendered this exact view: skip the duplicate first fetch.
    const skipFirst = refresh === 0 && servedKey.current === requestKey;
    servedKey.current = "";
    const first = skipFirst ? null : setTimeout(() => void load(), 0);
    const poll = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (first) clearTimeout(first);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, requestKey, tapStart, refresh]);

  // Once the first "leave by" passes, roll the list forward.
  const firstLeave = view?.rows[0]?.leaveAt ?? 0;
  const rolled = useRef(0);
  useEffect(() => {
    if (firstLeave && now > firstLeave + 15_000 && rolled.current !== firstLeave) {
      rolled.current = firstLeave;
      const id = setTimeout(() => setRefresh((n) => n + 1), 0);
      return () => clearTimeout(id);
    }
  }, [now, firstLeave]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), Math.max(0, toast.until - Date.now()));
    return () => clearTimeout(timer);
  }, [toast]);

  const choose = useCallback((k: string) => {
    const choice = { key: k, at: Date.now() };
    manual.current = choice;
    document.cookie = `${JOURNEY_CHOICE_COOKIE}=${serializeJourneyChoice(choice)}; max-age=${MANUAL_CHOICE_TTL_MS / 1000}; path=/; samesite=lax`;
    setKey(k);
  }, []);

  /** Today's taps from the server (ids for the timeline), then everything recomputes. */
  const reload = useCallback(async () => {
    const res = await fetch("/api/trip-events", { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const body = (await res.json()) as { events: Logged[] };
      setLogged(body.events);
    }
    setRefresh((n) => n + 1);
  }, []);

  // The platform the next ride tap is for: the owner's pick, else the journey's next step.
  const stepPlatform = steps.slice(nextIdx).find((s) => (s.kind === "at_platform" || s.kind === "board" || s.kind === "alight") && s.station && s.direction);
  const fromStep: PlatformChoice | null = stepPlatform ? { station: stepPlatform.station!, direction: stepPlatform.direction! } : null;
  const selected: PlatformChoice | null = override ?? fromStep;

  const startKind = placeKind(journey?.fromPlace);
  const endKind = placeKind(journey?.toPlace);
  const shownView = view && view.journeyKey === key ? view : null;
  const lastTapAt = mine.at(-1)?.at ?? 0;
  const finished = shownView?.progress.state === "finished" && dismissedAt !== lastTapAt;
  const primary = nextTapKind(next, shownView?.progress.state === "finished", endKind);
  const label = (kind: TapKind) => t(kind === "board" ? "boarding.boarded" : kind === "alight" ? "boarding.gotOff" : (kindLabel(kind) as DictKey));

  async function log(kind: TapKind, opts: { at?: number; timeSource?: "now" | "chosen" } = {}) {
    const tapped = nowMs();
    const at = opts.at ?? resolveTime(time, tapped);
    const timeSource = opts.timeSource ?? timeSourceOf(time);
    const usesPlatform = kind === "at_platform" || kind === "board" || kind === "alight";
    const step: Step | undefined = steps.slice(nextIdx).find((s) => s.kind === kind) ?? steps.find((s) => s.kind === kind);
    const platform = usesPlatform && selected ? getPlatform(selected.station) : step?.station ? getPlatform(step.station) : undefined;
    const direction = usesPlatform && selected ? selected.direction : step?.direction;
    const clientId = randomId();
    // Progress (and so the departures request) updates from this immediately.
    setLogged((l) => [...l, { id: -Date.now(), kind, at, station: platform?.code ?? null, line: platform?.line ?? null, direction: direction ?? null, journeyKey: key, clientId }]);
    setNow(tapped);
    setTime(NOW_CHOICE);
    setOverride(null);
    track("log_trip_event", { kind, ...(platform ? { station: platform.code, line: platform.line as LineCode } : {}) });
    if ((kind === "board" || kind === "alight") && platform && direction)
      track(kind === "board" ? "boarded_logged" : "alighted_logged", {
        station: platform.code,
        line: platform.line,
        direction,
        minutes_back: minutesBack(at, tapped),
        user_type: "owner",
        status: "approved",
      });
    const body = {
      clientId,
      kind,
      at: new Date(at).toISOString(),
      ...(platform ? { station: platform.code, line: platform.line } : {}),
      ...(direction ? { direction } : {}),
      journeyKey: key,
      timeSource,
    };
    const res = await fetch("/api/trip-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) {
      // No signal (underground): keep it on the phone with its own time; sent when back online.
      queue.enqueue("/api/trip-events", body);
      setToast({ clientId, id: null, at, kind, text: t("queue.saved", { time: clock(at) }), until: tapped + UNDO_MS, queued: true });
      return;
    }
    const saved = res.ok ? ((await res.json().catch(() => null)) as { id?: number | null } | null) : null;
    setToast({ clientId, id: saved?.id ?? null, at, kind, text: t("owner.logged", { what: label(kind), time: clock(at) }), until: tapped + UNDO_MS });
    await reload();
  }

  async function undo() {
    if (!toast) return;
    const id = toast.clientId;
    setToast(null);
    setLogged((l) => l.filter((e) => e.clientId !== id));
    await fetch(`/api/trip-events?clientId=${id}`, { method: "DELETE" }).catch(() => null);
    await reload();
  }

  /** "Wrong time?": move the tap back (the timeline edit; an edited boarding isn't scored). */
  async function fixTime(minutes: number) {
    if (!toast?.id) return;
    const at = toast.at - minutes * MINUTE;
    setToast({ ...toast, at, text: t("owner.logged", { what: label(toast.kind), time: clock(at) }) });
    await fetch("/api/trip-events", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: toast.id, at: new Date(at).toISOString() }) }).catch(() => null);
    await reload();
  }

  const readingStep = steps.slice(nextIdx).find((s) => s.kind === "at_platform" || s.kind === "board") ?? steps.find((s) => s.kind === "at_platform");
  const entryPlatform = readingStep?.station ? getPlatform(readingStep.station) : undefined;
  const entryDirection = entryPlatform && readingStep?.direction ? getDirection(entryPlatform.line, readingStep.direction) : undefined;
  const entry = entryPlatform && entryDirection ? { station: entryPlatform.code, line: entryPlatform.line, direction: entryDirection.key, board: entryDirection.board } : null;
  const ends = journey ? journeyEnds(journey.legs) : undefined;
  const others: TapKind[] = (["board", "alight", ...(startKind !== "arrived" ? [startKind] : []), "at_platform", "tap_out", endKind] as TapKind[]).filter((k) => k !== primary);
  const primaryStation = primary === "at_platform" || primary === "board" || primary === "alight" ? selected?.station : primary === "tap_out" ? next?.station : undefined;

  return (
    // Owner pages are masked in Clarity (no session recording of personal trips).
    <div className="space-y-5" data-clarity-mask="True">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{t("owner.title")}</h1>
        <select className="field ml-auto w-auto" value={key} onChange={(e) => choose(e.target.value)} aria-label={t("owner.journeys")}>
          {journeys.map((j) => (
            <option key={j.key} value={j.key}>
              {j.name}
            </option>
          ))}
        </select>
      </div>

      {/*
        One big, journey-aware next-step button, first on the page. It sticks
        to the bottom of the screen above the consent sheet (--consent-h) and
        the safe area, so it is never hidden under them. Saves at the chosen
        time (Now by default) on the first tap.
      */}
      {primary && (
        <div className="next-step-dock sticky z-30" data-next-step={primary}>
          <button type="button" onClick={() => void log(primary)} className="btn btn-primary min-h-16 w-full text-xl shadow-lg ring-4 ring-led/30">
            {t("owner.nextStep", {
              step: label(primary) + (primaryStation ? ` · ${stationForCode(primaryStation)?.name[locale] ?? primaryStation}` : ""),
            })}
          </button>
        </div>
      )}
      {toast && (
        <div role="status" className="space-y-2 rounded-lg bg-go/10 px-3 py-2 text-sm">
          <div className="flex items-center gap-3">
            <span className={`flex-1 ${toast.queued ? "text-warn" : ""}`}>{toast.text}</span>
            {!toast.queued && (
              <button type="button" className="font-semibold text-led" onClick={() => void undo()}>
                {t("owner.undo")}
              </button>
            )}
          </div>
          {toast.id != null && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted">{t("time.fix")}</span>
              {FIX_MINUTES.map((m) => (
                <button key={m} type="button" className="tabular rounded-full border border-line px-2.5 py-1" onClick={() => void fixTime(m)}>
                  {clock(toast.at - m * MINUTE)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <CommutePanel
        view={shownView}
        now={now}
        staleAt={staleAt}
        finished={
          finished
            ? {
                what: label(endKind),
                onLog: () => void log(endKind),
                onDismiss: () => setDismissedAt(lastTapAt),
              }
            : null
        }
      />

      <section className="panel space-y-3 p-4" aria-label={t("owner.logTitle")}>
        {/* GPS never overrides the journey step (underground it is unreliable): only offered without one. */}
        <PlatformPicker key={selected ? `${selected.station}-${selected.direction}` : "none"} value={selected} onChange={setOverride} surface="home" geo={!fromStep} />
        <TimeChips value={time} onChange={setTime} now={now} />
        <p className="text-xs text-muted">{t("owner.otherSteps")}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {others.map((k) => (
            <button key={k} type="button" onClick={() => void log(k)} className="btn btn-secondary min-h-12">
              {label(k)}
            </button>
          ))}
        </div>
        {queue.waiting > 0 && <p className="text-xs text-warn">{t("queue.waiting", { n: queue.waiting })}</p>}
      </section>

      <details className="panel p-4" open={mine.length > 0}>
        <summary className="cursor-pointer font-semibold">{t("timeline.title", { n: logged.length })}</summary>
        <div className="mt-3">
          <TripTimeline events={logged} onChanged={() => void reload()} />
        </div>
        <Link href={href("/me/stats")} className="mt-3 inline-block text-sm text-accent underline">
          {t("stats.link")}
        </Link>
      </details>

      <VersionFooter />
      <section>
        <h2 className="mb-2 font-semibold">{t("owner.reading")}</h2>
        {entry && <p className="text-sm text-muted">{stationForCode(entry.station)?.name[locale]} · {entry.station}</p>}
        {entry ? (
          <QuickEntry
            key={`${entry.station}-${entry.direction}`}
            station={entry.station}
            line={entry.line}
            direction={entry.direction}
            destination={entry.board[locale]}
            onSaved={() => setRefresh((n) => n + 1)}
            onUndone={() => setRefresh((n) => n + 1)}
          />
        ) : null}
        <Link href={href("/add")} className="mt-2 inline-block text-sm text-accent underline">
          {t("owner.otherStation")}
        </Link>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">{t("plan.title")}</h2>
        <Planner
          key={key}
          stations={stations}
          journeys={journeys.map((j) => ({ key: j.key, name: j.name, sheltered: j.sheltered }))}
          defaultJourney={key}
          defaultFrom={ends?.from}
          defaultTo={ends?.to}
          defaultWalkFrom={ends?.walkFrom}
          defaultWalkTo={ends?.walkTo}
          defaultTime={defaultTime}
          remindersAvailable={remindersAvailable}
        />
      </section>
    </div>
  );
}
