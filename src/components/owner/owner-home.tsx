"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { journeySteps, nextStepIndex, type StepKind } from "@/lib/journey/steps";
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
import { MINUTE, nowMs } from "@/lib/time";
import { randomId } from "@/lib/analytics/client";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { ReadingForm } from "../reading-form";
import { Planner } from "../plan/planner";
import { VersionFooter } from "../version-footer";
import { CommutePanel } from "./commute-panel";

type Journey = { key: string; name: string; fromPlace: string | null; legs: Leg[]; sheltered: boolean };
type Logged = { kind: string; station?: string | null; at: number; journeyKey?: string | null };

const BUTTONS: { kind: StepKind; label: "owner.atPlatform" | "owner.boarded" | "owner.gotOff" | "owner.tapOut" | "owner.arrived" }[] = [
  { kind: "at_platform", label: "owner.atPlatform" },
  { kind: "board", label: "owner.boarded" },
  { kind: "alight", label: "owner.gotOff" },
  { kind: "tap_out", label: "owner.tapOut" },
  { kind: "arrived", label: "owner.arrived" },
];
const UNDO_MS = 10_000;
const POLL_MS = 60_000;

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
  const { t } = useI18n();
  const { track } = useAnalytics();
  const [key, setKey] = useState(initialKey ?? journeys[0]?.key ?? "");
  const manual = useRef<JourneyChoice | null>(initialChoice);
  const [logged, setLogged] = useState<Logged[]>(today);
  const [toast, setToast] = useState<{ clientId: string; text: string; until: number } | null>(null);
  const [view, setView] = useState<CommuteView | null>(initialView);
  const [staleAt, setStaleAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => initialView?.generatedAt ?? 0);
  const [refresh, setRefresh] = useState(0);
  const journey = journeys.find((j) => j.key === key);
  const steps = useMemo(() => (journey ? journeySteps(journey.legs) : []), [journey]);
  const mine = useMemo(() => logged.filter((e) => !e.journeyKey || e.journeyKey === key), [logged, key]);
  const nextIdx = nextStepIndex(steps, mine);
  const next = steps[nextIdx];

  // Where the owner is along the journey; minute-granular so the request key stays stable.
  const minute = Math.floor(now / MINUTE) * MINUTE;
  const progress = useMemo(
    () => (journey && minute ? commuteProgress(journey.legs, mine, minute) : (initialView?.progress ?? { state: "idle" as const, fromLeg: 0, startAt: 0 })),
    [journey, mine, minute, initialView],
  );
  const laterStart = progress.startAt > minute ? progress.startAt : 0;
  const requestKey = `${key}|${progress.fromLeg}|${progress.state}|${laterStart}`;
  const servedKey = useRef(initialView ? `${initialView.journeyKey}|${initialView.progress.fromLeg}|${initialView.progress.state}|` : "");

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

  // Recompute on journey/progress change, after taps and readings, and every minute.
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    const [, fromLeg, state] = requestKey.split("|");
    const load = async () => {
      const q = new URLSearchParams({ journey: key, fromLeg, state });
      if (laterStart) q.set("startAt", String(laterStart));
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
  }, [key, requestKey, laterStart, refresh]);

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

  async function log(kind: StepKind) {
    // Timestamp = the moment of the tap.
    const at = nowMs();
    const step = steps.slice(nextIdx).find((s) => s.kind === kind) ?? steps.find((s) => s.kind === kind) ?? { kind };
    const clientId = randomId();
    const label = t(BUTTONS.find((b) => b.kind === kind)!.label);
    // Progress (and so the departures request) updates from this immediately.
    setLogged((l) => [...l, { kind, station: step.station, at, journeyKey: key }]);
    setNow(at);
    setToast({ clientId, text: t("owner.logged", { what: label, time: clock(at) }), until: at + UNDO_MS });
    track("log_trip_event", { kind, ...(step.station ? { station: step.station } : {}), ...(step.line ? { line: step.line as "EWL" } : {}) });
    await fetch("/api/trip-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, kind, at: new Date(at).toISOString(), station: step.station, line: step.line, direction: step.direction, journeyKey: key }),
    }).catch(() => null);
  }

  async function undo() {
    if (!toast) return;
    const id = toast.clientId;
    setToast(null);
    setLogged((l) => l.slice(0, -1));
    await fetch(`/api/trip-events?clientId=${id}`, { method: "DELETE" }).catch(() => null);
  }

  const readingStep = steps.slice(nextIdx).find((s) => s.kind === "at_platform" || s.kind === "board");
  const ends = journey ? journeyEnds(journey.legs) : undefined;
  const shownView = view && view.journeyKey === key ? view : null;

  return (
    <div className="space-y-5">
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

      <CommutePanel view={shownView} now={now} staleAt={staleAt} />

      {next && <p className="text-sm text-muted">{t("owner.next", { step: t(BUTTONS.find((b) => b.kind === next.kind)!.label) + (next.station ? ` · ${next.station}` : "") })}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {BUTTONS.map((b) => {
          const expected = next?.kind === b.kind;
          return (
            <button
              key={b.kind}
              type="button"
              onClick={() => void log(b.kind)}
              className={`btn min-h-16 text-lg ${expected ? "btn-primary ring-4 ring-led/30" : "btn-secondary"}`}
            >
              {t(b.label)}
            </button>
          );
        })}
      </div>
      {toast && (
        <div role="status" className="panel flex items-center gap-3 px-4 py-3 text-sm">
          <span className="flex-1">{toast.text}</span>
          <button type="button" className="font-semibold text-led" onClick={() => void undo()}>
            {t("owner.undo")}
          </button>
        </div>
      )}
      <VersionFooter />
      <section>
        <h2 className="mb-2 font-semibold">{t("owner.reading")}</h2>
        <ReadingForm
          key={`${readingStep?.station}-${readingStep?.direction}`}
          defaultStation={readingStep?.station ?? "EW17"}
          defaultDirection={readingStep?.direction}
          onSaved={() => setRefresh((n) => n + 1)}
        />
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
