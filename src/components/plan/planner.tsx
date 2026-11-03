"use client";
import { useState } from "react";
import { CloudRain, Footprints, Repeat, TrainFront } from "lucide-react";
import type { Plan, PlannedLeg } from "@/lib/journey/plan";
import type { PlanResponse } from "@/lib/server/journeys";
import { BUS_APP_URL } from "@/lib/push/disruptions";
import { LINES, PLATFORMS } from "@/lib/network/data";
import { clock } from "@/lib/format";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";

type StationOption = { slug: string; name: string };
type JourneyOption = { key: string; name: string; sheltered: boolean };
type Mode = "depart" | "leave_by" | "list";

export function Planner({
  stations,
  journeys = [],
  defaultFrom = "tiong-bahru",
  defaultTo = "shenton-way",
  remindersAvailable = false,
}: {
  stations: StationOption[];
  journeys?: JourneyOption[];
  defaultFrom?: string;
  defaultTo?: string;
  remindersAvailable?: boolean;
}) {
  const { t } = useI18n();
  const { track } = useAnalytics();
  const [journey, setJourney] = useState(journeys[0]?.key ?? "");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [walkFrom, setWalkFrom] = useState(0);
  const [walkTo, setWalkTo] = useState(0);
  const [mode, setMode] = useState<Mode>("depart");
  const [time, setTime] = useState("");
  const [result, setResult] = useState<(PlanResponse & { journey?: JourneyOption }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminded, setReminded] = useState<number | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const q = new URLSearchParams({ mode });
    if (time) q.set("time", time);
    if (journey) q.set("journey", journey);
    else {
      q.set("from", from);
      q.set("to", to);
      q.set("walkFrom", String(walkFrom));
      q.set("walkTo", String(walkTo));
    }
    const res = await fetch(`/api/plan?${q}`, { cache: "no-store" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setResult(null);
      setError(t("plan.noRoute"));
      return;
    }
    const body = (await res.json()) as PlanResponse & { journey?: JourneyOption };
    setResult(body);
    const rides = body.legs.filter((l) => l.kind === "ride");
    const first = rides[0];
    const last = rides.at(-1);
    const ownerFrom = (first?.kind === "ride" && PLATFORMS[first.from]?.station) || from;
    const ownerTo = (last?.kind === "ride" && PLATFORMS[last.to]?.station) || to;
    track("planner_query", {
      from_station: journey ? ownerFrom : from,
      to_station: journey ? ownerTo : to,
      mode,
      transfers: Math.min(2, Math.max(0, rides.length - 1)),
      journey_type: journey ? "owner_saved" : "public",
    });
    if (journey) track("journey_view", { journey_type: "owner_saved", journey_key: journey });
  }

  async function remind(plan: Plan) {
    const res = await fetch("/api/push/leave", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leaveAt: new Date(plan.departAt).toISOString(),
        arriveAt: new Date(plan.arriveAt).toISOString(),
        journeyName: result?.journey?.name ?? "MRT",
      }),
    }).catch(() => null);
    if (res?.ok) setReminded(plan.departAt);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={run} className="panel grid gap-3 p-4 sm:grid-cols-2">
        {journeys.length > 0 && (
          <label className="text-sm text-muted sm:col-span-2">
            {t("plan.journey")}
            <select className="field mt-1" value={journey} onChange={(e) => setJourney(e.target.value)}>
              {journeys.map((j) => (
                <option key={j.key} value={j.key}>
                  {j.name}
                </option>
              ))}
              <option value="">— {t("plan.from")} / {t("plan.to")} —</option>
            </select>
          </label>
        )}
        {!journey && (
          <>
            <StationSelect label={t("plan.from")} value={from} onChange={setFrom} stations={stations} />
            <StationSelect label={t("plan.to")} value={to} onChange={setTo} stations={stations} />
            <NumberField label={t("plan.walkFrom")} value={walkFrom} onChange={setWalkFrom} />
            <NumberField label={t("plan.walkTo")} value={walkTo} onChange={setWalkTo} />
          </>
        )}
        <fieldset className="sm:col-span-2">
          <legend className="text-sm text-muted">{t("plan.mode")}</legend>
          <div className="mt-1 flex gap-2">
            {(["depart", "leave_by", "list"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm ${mode === m ? "border-led bg-led text-black" : "border-line"}`}
              >
                {t(`plan.mode.${m}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="text-sm text-muted">
          {t("plan.time")}
          <input type="time" className="field mt-1" value={time} onChange={(e) => setTime(e.target.value)} placeholder={t("plan.now")} />
        </label>
        <div className="flex items-end">
          <button className="btn btn-primary w-full" disabled={busy}>
            {t("plan.go")}
          </button>
        </div>
      </form>

      {error && <p className="text-bad">{error}</p>}
      {result && (
        <div className="space-y-3">
          {result.rain?.rainy && (
            <p className="flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm text-accent">
              <CloudRain size={16} aria-hidden /> {t("plan.rain", { area: result.rain.area, forecast: result.rain.forecast })}
            </p>
          )}
          {result.alertLines.length > 0 && (
            <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">
              {t("alert.title")} · {result.alertLines.join(", ")} —{" "}
              <a className="underline" href={BUS_APP_URL}>
                {t("alert.bus")}
              </a>
            </p>
          )}
          {result.plans.map((plan, i) => (
            <PlanCard key={`${plan.departAt}-${i}`} plan={plan} onRemind={remindersAvailable ? () => void remind(plan) : undefined} reminded={reminded === plan.departAt} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, onRemind, reminded }: { plan: Plan; onRemind?: () => void; reminded: boolean }) {
  const { t } = useI18n();
  return (
    <article className="panel rise p-4">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span className="led text-2xl font-bold">{t("plan.leave", { time: clock(plan.departAt) })}</span>
        <span className="text-lg">{t("plan.arrive", { time: clock(plan.arriveAt) })}</span>
        <span className="text-xs text-muted">{t("plan.range", { best: clock(plan.best), worst: clock(plan.worst) })}</span>
      </div>
      <ol className="mt-3 space-y-2 text-sm">
        {plan.legs.map((l, i) => (
          <LegRow key={i} planned={l} />
        ))}
      </ol>
      {onRemind && (
        <button type="button" className="btn btn-secondary mt-3 py-2 text-sm" onClick={onRemind} disabled={reminded}>
          {reminded ? t("plan.reminded") : t("plan.remind")}
        </button>
      )}
    </article>
  );
}

function LegRow({ planned }: { planned: PlannedLeg }) {
  const { t } = useI18n();
  const leg = planned.leg;
  if (leg.kind === "walk")
    return (
      <li className="flex items-center gap-2 text-muted">
        <Footprints size={14} aria-hidden /> {t("plan.walk", { n: leg.min })} {leg.label ? `· ${leg.label}` : ""}
      </li>
    );
  if (leg.kind === "transfer")
    return (
      <li className="flex items-center gap-2 text-muted">
        <Repeat size={14} aria-hidden /> {t("plan.transfer", { n: leg.min })}
      </li>
    );
  const color = LINES[leg.line as keyof typeof LINES]?.color ?? "#888";
  const catchText =
    planned.catch === "wait" ? t("plan.catch.wait", { n: Math.round(planned.slackMin ?? 0) }) : planned.catch ? t(`plan.catch.${planned.catch}`) : "";
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <TrainFront size={14} aria-hidden style={{ color }} />
        <span className="chip text-white" style={{ background: color }}>
          {leg.line}
        </span>
        <span>{t("plan.board", { line: "", time: clock(planned.boardAt ?? planned.start) })}</span>
        <span className="text-muted">{t("plan.ride", { line: "", from: leg.from, to: leg.to, n: Math.round((planned.end - (planned.boardAt ?? planned.start)) / 60_000) })}</span>
        <span className={`chip ${planned.catch === "tight" ? "bg-bad/15 text-bad" : planned.catch === "likely" ? "bg-warn/15 text-warn" : "bg-go/15 text-go"}`}>{catchText}</span>
        {planned.estimate && <span className="text-xs text-muted">({t("plan.estimate")})</span>}
      </div>
      {leg.tip && (
        <p className="mt-1 pl-6 text-xs text-led">
          {t("owner.tip")}: {leg.tip}
        </p>
      )}
    </li>
  );
}

function StationSelect({ label, value, onChange, stations }: { label: string; value: string; onChange: (v: string) => void; stations: StationOption[] }) {
  return (
    <label className="text-sm text-muted">
      {label}
      <select className="field mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {stations.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-sm text-muted">
      {label}
      <input type="number" min={0} max={60} inputMode="numeric" className="field mt-1" value={value} onChange={(e) => onChange(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} />
    </label>
  );
}
