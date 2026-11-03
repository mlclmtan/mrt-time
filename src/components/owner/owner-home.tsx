"use client";
import { useEffect, useMemo, useState } from "react";
import { journeySteps, nextStepIndex, type StepKind } from "@/lib/journey/steps";
import type { Leg } from "@/lib/journey/plan";
import { clock } from "@/lib/format";
import { nowMs } from "@/lib/time";
import { randomId } from "@/lib/analytics/client";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { ReadingForm } from "../reading-form";
import { Planner } from "../plan/planner";

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

export function OwnerHome({
  journeys,
  initialKey,
  today,
  stations,
  remindersAvailable,
}: {
  journeys: Journey[];
  initialKey?: string;
  today: Logged[];
  stations: { slug: string; name: string }[];
  remindersAvailable: boolean;
}) {
  const { t } = useI18n();
  const { track } = useAnalytics();
  const [key, setKey] = useState(initialKey ?? journeys[0]?.key ?? "");
  const [logged, setLogged] = useState<Logged[]>(today);
  const [toast, setToast] = useState<{ clientId: string; text: string; until: number } | null>(null);
  const journey = journeys.find((j) => j.key === key);
  const steps = useMemo(() => (journey ? journeySteps(journey.legs) : []), [journey]);
  const mine = logged.filter((e) => !e.journeyKey || e.journeyKey === key);
  const nextIdx = nextStepIndex(steps, mine);
  const next = steps[nextIdx];

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), Math.max(0, toast.until - Date.now()));
    return () => clearTimeout(timer);
  }, [toast]);

  async function log(kind: StepKind) {
    // Timestamp = the moment of the tap.
    const at = nowMs();
    const step = steps.slice(nextIdx).find((s) => s.kind === kind) ?? steps.find((s) => s.kind === kind) ?? { kind };
    const clientId = randomId();
    const label = t(BUTTONS.find((b) => b.kind === kind)!.label);
    setLogged((l) => [...l, { kind, station: step.station, at, journeyKey: key }]);
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{t("owner.title")}</h1>
        <select className="field ml-auto w-auto" value={key} onChange={(e) => setKey(e.target.value)} aria-label={t("owner.journeys")}>
          {journeys.map((j) => (
            <option key={j.key} value={j.key}>
              {j.name}
            </option>
          ))}
        </select>
      </div>
      {next && <p className="text-sm text-muted">{t("owner.next", { step: t(BUTTONS.find((b) => b.kind === next.kind)!.label) + (next.station ? ` · ${next.station}` : "") })}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {BUTTONS.map((b) => {
          const expected = next?.kind === b.kind;
          return (
            <button
              key={b.kind}
              type="button"
              onClick={() => void log(b.kind)}
              className={`btn min-h-20 text-lg ${expected ? "btn-primary ring-4 ring-led/30" : "btn-secondary"}`}
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
      <section>
        <h2 className="mb-2 font-semibold">{t("owner.reading")}</h2>
        <ReadingForm key={`${readingStep?.station}-${readingStep?.direction}`} defaultStation={readingStep?.station ?? "EW17"} defaultDirection={readingStep?.direction} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">{t("plan.title")}</h2>
        <Planner
          stations={stations}
          journeys={journeys.map((j) => ({ key: j.key, name: j.name, sheltered: j.sheltered }))}
          remindersAvailable={remindersAvailable}
        />
      </section>
    </div>
  );
}
