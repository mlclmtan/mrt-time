"use client";
import { useEffect, useState } from "react";
import { LogIn, LogOut, Sparkles } from "lucide-react";
import {
  MAX_BACKDATE_MIN,
  PUBLIC_MAX_BACKDATE_MIN,
  UNDO_MS,
  buildSightingPost,
  minutesBack,
  postSighting,
  undoSighting,
  type SightingKindInput,
} from "@/lib/sightings/client";
import type { LineCode } from "@/lib/network";
import { clock, clockSeconds } from "@/lib/format";
import { MINUTE, nowMs } from "@/lib/time";
import { useAnalytics } from "../analytics/analytics-provider";
import { addBreadcrumb } from "@/lib/analytics/health";
import { useI18n } from "../i18n";
import { useTapQueue } from "./tap-queue";

type Saved = { what: SightingKindInput; at: number; id: number | null; clientId: string | null; pending: boolean; until: number };
type Status = { kind: "idle" | "busy" | "limit" | "error" | "undone" } | ({ kind: "saved" } & Saved) | { kind: "queued"; at: number };

/** Minutes the "Wrong time?" chips move a saved tap back. */
const FIX_MINUTES = [1, 2, 5] as const;

/**
 * "I boarded" / "Got off" for one platform direction. One tap saves at once
 * at Date.now(); the toast shows the time with seconds ("Boarded 10:14:32")
 * and offers Undo and "Wrong time?" −1 / −2 / −5 min buttons for 10 s.
 * A boarding is a sighting of a real train: the boards along the line use it
 * at once. With no connection the tap is kept on the phone and sent later.
 */
export function BoardingButtons({
  station,
  line,
  direction,
  destination,
  onSaved,
  onUndone,
  onScreenSays,
  showScreenSays = false,
}: {
  station: string;
  line: LineCode;
  direction: string;
  /** As the platform board shows it, e.g. "Pasir Ris". */
  destination: string;
  onSaved?: (s: { kind: SightingKindInput; at: number }) => void;
  onUndone?: () => void;
  onScreenSays?: () => void;
  showScreenSays?: boolean;
}) {
  const { t } = useI18n();
  const { track, deviceId, userType } = useAnalytics();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const owner = userType === "owner";
  const maxBack = owner ? MAX_BACKDATE_MIN : PUBLIC_MAX_BACKDATE_MIN;
  const queue = useTapQueue();

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
    onSaved?.({ kind, at });
  }

  async function log(kind: SightingKindInput) {
    addBreadcrumb(`tap:${kind}`);
    const tapped = nowMs();
    await save(kind, tapped, tapped, "now");
  }

  async function undo() {
    if (status.kind !== "saved") return;
    track("tap_undo", {});
    const ref = { id: status.id, clientId: status.clientId };
    setStatus({ kind: "undone" });
    await undoSighting(ref, { deviceId: deviceId() });
    onUndone?.();
  }

  /** "Wrong time?": take the tap back and save it again a few minutes earlier. */
  async function fixTime(minutes: number) {
    if (status.kind !== "saved") return;
    track("tap_correction", { minutes: (-minutes) as -1 | -2 | -5 });
    const { what, at, id, clientId } = status;
    setStatus({ kind: "busy" });
    await undoSighting({ id, clientId }, { deviceId: deviceId() });
    const tapped = nowMs();
    await save(what, Math.max(tapped - maxBack * MINUTE, at - minutes * MINUTE), tapped, "chosen");
  }

  const hasThreeButtons = showScreenSays || Boolean(onScreenSays);

  return (
    <div className="mt-2" data-boarding={`${station}:${direction}`}>
      <span className="sr-only">{destination}</span>
      <div className={`grid gap-2 ${hasThreeButtons ? "grid-cols-3" : "grid-cols-2"}`}>
        <button
          type="button"
          className="btn btn-primary min-h-[44px] h-11 py-1 px-2 text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5"
          disabled={status.kind === "busy"}
          onClick={() => void log("boarded")}
        >
          <LogIn size={15} aria-hidden className="shrink-0" />
          <span>{t("boarding.boarded")}</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary min-h-[44px] h-11 py-1 px-2 text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5"
          disabled={status.kind === "busy"}
          onClick={() => void log("alighted")}
        >
          <LogOut size={15} aria-hidden className="shrink-0" />
          <span>{t("boarding.gotOff")}</span>
        </button>
        {hasThreeButtons && (
          <button
            type="button"
            onClick={onScreenSays}
            aria-label={t("trip.action.screenSays")}
            className="btn btn-secondary min-h-[44px] h-11 py-1 px-2 text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5"
          >
            <Sparkles size={15} aria-hidden className="shrink-0" />
            <span className="hidden sm:inline truncate">{t("trip.action.screenSays")}</span>
            <span className="sm:hidden whitespace-nowrap">{t("boarding.screenShort")}</span>
          </button>
        )}
      </div>
      {status.kind === "saved" && (
        <div role="status" className="mt-2 space-y-1.5 rounded-lg bg-go/10 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="flex-1 font-semibold text-go">
              {status.pending
                ? t("boarding.savedPending", {
                    time: clockSeconds(status.at),
                    what: t(status.what === "boarded" ? "boarding.boarded" : "boarding.gotOff"),
                  })
                : t(status.what === "boarded" ? "trip.logged.board" : "trip.logged.alight", {
                    time: clockSeconds(status.at),
                  })}
            </span>
            <button
              type="button"
              className="min-h-[44px] min-w-[44px] px-3 font-semibold text-led hover:text-led/80 active:scale-95 flex items-center justify-center"
              onClick={() => void undo()}
            >
              {t("entry.undo")}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/40 pt-1.5 text-xs">
            <span className="text-muted">{t("trip.action.wrongTime")}</span>
            <div className="flex items-center gap-2">
              {FIX_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-lg border border-line bg-panel-2 font-semibold text-xs tabular flex items-center justify-center active:scale-95"
                  onClick={() => void fixTime(m)}
                >
                  {t("time.minus", { n: m })}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {status.kind === "queued" && <p className="mt-2 text-xs text-warn">{t("queue.saved", { time: clock(status.at) })}</p>}
      {status.kind === "undone" && <p className="mt-2 text-xs text-muted">{t("entry.undone")}</p>}
      {status.kind === "limit" && <p className="mt-2 text-xs text-warn">{t("reading.limit")}</p>}
      {status.kind === "error" && <p className="mt-2 text-xs text-bad">{t("reading.error")}</p>}
    </div>
  );
}
