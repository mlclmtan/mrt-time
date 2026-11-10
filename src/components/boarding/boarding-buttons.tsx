"use client";
import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import {
  MAX_BACKDATE_MIN,
  NOW_CHOICE,
  PUBLIC_MAX_BACKDATE_MIN,
  UNDO_MS,
  buildSightingPost,
  minutesBack,
  postSighting,
  resolveTime,
  timeSourceOf,
  undoSighting,
  type SightingKindInput,
  type TimeChoice,
} from "@/lib/sightings/client";
import type { LineCode } from "@/lib/network";
import { clock } from "@/lib/format";
import { MINUTE, nowMs } from "@/lib/time";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { TimeChips } from "./time-chips";
import { useTapQueue } from "./tap-queue";

type Saved = { what: SightingKindInput; at: number; id: number | null; clientId: string | null; pending: boolean; until: number };
type Status = { kind: "idle" | "busy" | "limit" | "error" | "undone" } | ({ kind: "saved" } & Saved) | { kind: "queued"; at: number };

/** Minutes the "Wrong time?" chips move a saved tap back. */
const FIX_MINUTES = [1, 2, 5] as const;

/**
 * "I boarded" / "Got off" for one platform direction. One tap saves at once
 * at Now (or the time chip picked); the toast offers Undo and "Wrong time?
 * 10:13 · 10:12 · 10:09" for 10 s. A boarding is a sighting of a real
 * train: the boards along the line use it at once. With no connection the
 * tap is kept on the phone and sent later with its own time.
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
  const owner = userType === "owner";
  const maxBack = owner ? MAX_BACKDATE_MIN : PUBLIC_MAX_BACKDATE_MIN;
  const queue = useTapQueue();

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

  async function save(kind: SightingKindInput, at: number, tapped: number, timeSource: "now" | "chosen") {
    setStatus({ kind: "busy" });
    const id = deviceId();
    const result = await postSighting(buildSightingPost({ station, direction, kind, at, timeSource }), {
      deviceId: id,
      queue: (url, body) => queue.enqueue(url, body, id ? { "x-device-id": id } : undefined),
    });
    const event = kind === "boarded" ? "boarded_logged" : "alighted_logged";
    const base = { station, line, direction, minutes_back: minutesBack(at, tapped), user_type: owner ? ("owner" as const) : ("visitor" as const) };
    if (result.kind === "limit") {
      track(event, { ...base, status: "rate_limited" });
      return setStatus({ kind: "limit" });
    }
    if (result.kind === "error") return setStatus({ kind: "error" });
    if (result.kind === "queued") return setStatus({ kind: "queued", at });
    track(event, { ...base, status: result.kind });
    setStatus({ kind: "saved", what: kind, at, id: result.id, clientId: result.clientId, pending: result.kind === "pending", until: tapped + UNDO_MS });
    setTime(NOW_CHOICE);
    onSaved?.({ kind, at });
  }

  async function log(kind: SightingKindInput) {
    const tapped = nowMs();
    await save(kind, resolveTime(time, tapped, maxBack), tapped, timeSourceOf(time));
  }

  async function undo() {
    if (status.kind !== "saved") return;
    const ref = { id: status.id, clientId: status.clientId };
    setStatus({ kind: "undone" });
    await undoSighting(ref, { deviceId: deviceId() });
    onUndone?.();
  }

  /** "Wrong time?": take the tap back and save it again a few minutes earlier. */
  async function fixTime(minutes: number) {
    if (status.kind !== "saved") return;
    const { what, at, id, clientId } = status;
    setStatus({ kind: "busy" });
    await undoSighting({ id, clientId }, { deviceId: deviceId() });
    const tapped = nowMs();
    await save(what, Math.max(tapped - maxBack * MINUTE, at - minutes * MINUTE), tapped, "chosen");
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-bg/40 p-3" data-boarding={`${station}:${direction}`}>
      <p className="text-sm text-muted">{t("boarding.prompt", { dest: destination })}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-primary min-h-14 text-lg" disabled={status.kind === "busy"} onClick={() => void log("boarded")}>
          <LogIn size={18} aria-hidden /> {t("boarding.boarded")}
        </button>
        <button type="button" className="btn btn-secondary min-h-14 text-lg" disabled={status.kind === "busy"} onClick={() => void log("alighted")}>
          <LogOut size={18} aria-hidden /> {t("boarding.gotOff")}
        </button>
      </div>
      <div className="mt-2">
        <TimeChips value={time} onChange={setTime} now={now} maxBackMin={maxBack} />
      </div>
      {status.kind === "saved" && (
        <div role="status" className="mt-3 space-y-2 rounded-lg bg-go/10 px-3 py-2 text-sm">
          <div className="flex items-center gap-3">
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
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">{t("time.fix")}</span>
            {FIX_MINUTES.map((m) => (
              <button key={m} type="button" className="tabular rounded-full border border-line px-2.5 py-1" onClick={() => void fixTime(m)}>
                {clock(status.at - m * MINUTE)}
              </button>
            ))}
          </div>
        </div>
      )}
      {status.kind === "queued" && <p className="mt-2 text-sm text-warn">{t("queue.saved", { time: clock(status.at) })}</p>}
      {status.kind === "undone" && <p className="mt-2 text-sm text-muted">{t("entry.undone")}</p>}
      {status.kind === "limit" && <p className="mt-2 text-sm text-warn">{t("reading.limit")}</p>}
      {status.kind === "error" && <p className="mt-2 text-sm text-bad">{t("reading.error")}</p>}
    </div>
  );
}
