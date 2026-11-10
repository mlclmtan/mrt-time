"use client";
import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import {
  NOW_CHOICE,
  UNDO_MS,
  buildSightingPost,
  minutesBack,
  postSighting,
  resolveTime,
  undoSighting,
  type SightingKindInput,
  type TimeChoice,
} from "@/lib/sightings/client";
import type { LineCode } from "@/lib/network";
import { clock } from "@/lib/format";
import { nowMs } from "@/lib/time";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { TimeChips } from "./time-chips";

type Saved = { what: SightingKindInput; at: number; id: number | null; clientId: string | null; pending: boolean; until: number };
type Status = { kind: "idle" | "busy" | "limit" | "error" | "undone" } | ({ kind: "saved" } & Saved);

/**
 * "I boarded" / "Got off" for one platform direction, with a time (Now ·
 * −1 · −2 · −5 min · Pick time). A boarding is an exact sighting of a real
 * train: every board on the line uses it at once. Undo for 10 s.
 */
export function BoardingButtons({
  station,
  line,
  direction,
  destination,
  onSaved,
  onUndone,
}: {
  station: string;
  line: LineCode;
  direction: string;
  /** As the platform board shows it, e.g. "Pasir Ris". */
  destination: string;
  onSaved?: (s: { kind: SightingKindInput; at: number }) => void;
  onUndone?: () => void;
}) {
  const { t } = useI18n();
  const { track, deviceId, userType } = useAnalytics();
  const [time, setTime] = useState<TimeChoice>(NOW_CHOICE);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(nowMs());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const savedUntil = status.kind === "saved" ? status.until : 0;
  useEffect(() => {
    if (!savedUntil) return;
    const id = setTimeout(() => setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s)), Math.max(0, savedUntil - Date.now()));
    return () => clearTimeout(id);
  }, [savedUntil]);

  async function log(kind: SightingKindInput) {
    const tapped = nowMs();
    const at = resolveTime(time, tapped);
    setStatus({ kind: "busy" });
    const result = await postSighting(buildSightingPost({ station, direction, kind, at }), { deviceId: deviceId() });
    const event = kind === "boarded" ? "boarded_logged" : "alighted_logged";
    const owner = userType === "owner";
    const base = { station, line, direction, minutes_back: minutesBack(at, tapped), user_type: owner ? ("owner" as const) : ("visitor" as const) };
    if (result.kind === "limit") {
      track(event, { ...base, status: "rate_limited" });
      return setStatus({ kind: "limit" });
    }
    if (result.kind === "error") return setStatus({ kind: "error" });
    track(event, { ...base, status: result.kind });
    setStatus({ kind: "saved", what: kind, at, id: result.id, clientId: result.clientId, pending: result.kind === "pending", until: tapped + UNDO_MS });
    setTime(NOW_CHOICE);
    onSaved?.({ kind, at });
  }

  async function undo() {
    if (status.kind !== "saved") return;
    const ref = { id: status.id, clientId: status.clientId };
    setStatus({ kind: "undone" });
    await undoSighting(ref, { deviceId: deviceId() });
    onUndone?.();
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-bg/40 p-3" data-boarding={`${station}:${direction}`}>
      <p className="text-sm text-muted">{t("boarding.prompt", { dest: destination })}</p>
      <div className="mt-2">
        <TimeChips value={time} onChange={setTime} now={now} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-primary min-h-14 text-lg" disabled={status.kind === "busy"} onClick={() => void log("boarded")}>
          <LogIn size={18} aria-hidden /> {t("boarding.boarded")}
        </button>
        <button type="button" className="btn btn-secondary min-h-14 text-lg" disabled={status.kind === "busy"} onClick={() => void log("alighted")}>
          <LogOut size={18} aria-hidden /> {t("boarding.gotOff")}
        </button>
      </div>
      {status.kind === "saved" && (
        <div role="status" className="mt-3 flex items-center gap-3 rounded-lg bg-go/10 px-3 py-2 text-sm">
          <span className="flex-1 text-go">
            {t(status.pending ? "boarding.savedPending" : "boarding.saved", {
              time: clock(status.at),
              what: t(status.what === "boarded" ? "boarding.boarded" : "boarding.gotOff"),
            })}
          </span>
          <button type="button" className="font-semibold text-led" onClick={() => void undo()}>
            {t("entry.undo")}
          </button>
        </div>
      )}
      {status.kind === "undone" && <p className="mt-2 text-sm text-muted">{t("entry.undone")}</p>}
      {status.kind === "limit" && <p className="mt-2 text-sm text-warn">{t("reading.limit")}</p>}
      {status.kind === "error" && <p className="mt-2 text-sm text-bad">{t("reading.error")}</p>}
    </div>
  );
}
