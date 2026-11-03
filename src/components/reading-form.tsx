"use client";
import { useMemo, useState } from "react";
import { Delete } from "lucide-react";
import { LINES, PLATFORMS, STATIONS } from "@/lib/network/data";
import { useAnalytics } from "./analytics/analytics-provider";
import { useI18n } from "./i18n";

const PLATFORM_LIST = Object.values(PLATFORMS).sort((a, b) => a.code.localeCompare(b.code));

/** Station + direction + number pad for up to 3 trains. Optional photo is never stored. */
export function ReadingForm({
  defaultStation = "EW17",
  defaultDirection,
  onSaved,
}: {
  defaultStation?: string;
  defaultDirection?: string;
  /** Called once the reading is stored (e.g. to recompute predictions). */
  onSaved?: (status: "approved" | "pending") => void;
}) {
  const { t, locale } = useI18n();
  const { track, deviceId } = useAnalytics();
  const [station, setStation] = useState(defaultStation);
  const line = PLATFORMS[station]?.line ?? "EWL";
  const directions = useMemo(() => Object.values(LINES[line].directions).filter((d) => d.terminal !== station), [line, station]);
  const [direction, setDirection] = useState(defaultDirection ?? directions[0]?.key ?? "");
  const [slots, setSlots] = useState<string[]>(["", "", ""]);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "approved" | "pending" | "limit" | "error" }>({ kind: "idle" });
  const validDirection = directions.some((d) => d.key === direction) ? direction : directions[0]?.key ?? "";

  const press = (digit: string) =>
    setSlots((s) => {
      const next = [...s];
      next[active] = (next[active] + digit).replace(/^0(\d)/, "$1").slice(0, 2);
      return next;
    });
  const back = () => setSlots((s) => s.map((v, i) => (i === active ? v.slice(0, -1) : v)));

  async function save() {
    const minutes = slots.filter((s) => s !== "").map(Number);
    if (!minutes.length) return;
    setState({ kind: "busy" });
    const res = await fetch("/api/readings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: deviceId(), reading: { station, direction: validDirection, minutes, capturedAt: new Date().toISOString() } }),
    }).catch(() => null);
    if (res?.status === 429) {
      track("submit_reading", { station, line, direction: validDirection, status: "rate_limited" });
      return setState({ kind: "limit" });
    }
    if (!res?.ok) return setState({ kind: "error" });
    const body = (await res.json()) as { status: "approved" | "pending" };
    track("submit_reading", { station, line, direction: validDirection, status: body.status });
    track("log_reading", { station, line, direction: validDirection, trains: Math.min(3, minutes.length) });
    setState({ kind: body.status });
    setSlots(["", "", ""]);
    setActive(0);
    onSaved?.(body.status);
  }

  return (
    <div className="panel space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-muted">
          {t("reading.station")}
          <select className="field mt-1" value={station} onChange={(e) => setStation(e.target.value)}>
            {PLATFORM_LIST.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {STATIONS.find((s) => s.slug === p.station)?.name[locale]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted">
          {t("reading.direction")}
          <select className="field mt-1" value={validDirection} onChange={(e) => setDirection(e.target.value)}>
            {directions.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label[locale]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset>
        <legend className="text-sm text-muted">{t("reading.minutes")}</legend>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {slots.map((v, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-pressed={active === i}
              aria-label={t("reading.train", { n: i + 1 })}
              className={`rounded-xl border py-3 text-center ${active === i ? "border-led" : "border-line"}`}
            >
              <span className="led text-3xl font-bold">{v || "–"}</span>
              <span className="block text-[10px] text-muted">{t("reading.train", { n: i + 1 })}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" className="btn btn-secondary text-xl" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="btn btn-secondary text-sm" onClick={() => setActive((a) => Math.min(2, a + 1))}>
          →
        </button>
        <button type="button" className="btn btn-secondary text-xl" onClick={() => press("0")}>
          0
        </button>
        <button type="button" className="btn btn-secondary" onClick={back} aria-label={t("reading.clear")}>
          <Delete size={18} />
        </button>
      </div>
      <button type="button" className="btn btn-primary w-full" disabled={state.kind === "busy" || !slots[0]} onClick={() => void save()}>
        {t("reading.save")}
      </button>
      {state.kind === "approved" && <p className="text-go">{t("reading.saved.approved")}</p>}
      {state.kind === "pending" && <p className="text-warn">{t("reading.saved.pending")}</p>}
      {state.kind === "limit" && <p className="text-warn">{t("reading.limit")}</p>}
      {state.kind === "error" && <p className="text-bad">{t("reading.error")}</p>}
    </div>
  );
}
