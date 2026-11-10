"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  CHIP_MINUTES,
  MAX_SEEN_AGO_MIN,
  UNDO_MS,
  buildReadingPost,
  clampSeenAt,
  clearSlot,
  emptySlots,
  fillNextSlot,
  forgetMyReading,
  localObservation,
  postReading,
  rememberMyReading,
  undoReading,
  type Slots,
} from "@/lib/readings/entry";
import type { Observation } from "@/lib/predict/types";
import { clock } from "@/lib/format";
import { MINUTE, nowMs, sgtDate, sgtInstant } from "@/lib/time";
import type { LineCode } from "@/lib/network/data";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";

type Status = { kind: "idle" | "busy" | "limit" | "error" | "undone" } | { kind: "saved"; pending: boolean; obs: Observation; id: number | null; until: number };

/**
 * "Screen says: next train to Pasir Ris in [ ] min, then [ ] min".
 * Chips 0–15 fill the next empty box; time seen = now unless changed.
 */
export function QuickEntry({
  station,
  line,
  direction,
  destination,
  startOpen = false,
  onSaved,
  onUndone,
}: {
  station: string;
  line: LineCode;
  direction: string;
  /** As the platform board shows it, e.g. "Pasir Ris". */
  destination: string;
  startOpen?: boolean;
  onSaved?: (obs: Observation, status: "approved" | "pending") => void;
  onUndone?: (obs: Observation) => void;
}) {
  const { t } = useI18n();
  const { track, deviceId } = useAnalytics();
  const [open, setOpen] = useState(startOpen);
  const [slots, setSlots] = useState<Slots>(emptySlots);
  const [third, setThird] = useState(false);
  const [other, setOther] = useState("");
  const [seenAt, setSeenAt] = useState<number | null>(null); // null = now
  const [editTime, setEditTime] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [now, setNow] = useState(0);
  const limit = third ? 3 : 2;

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

  const tap = (m: number) => {
    setOpen(true);
    setSlots((s) => fillNextSlot(s, m, limit));
  };
  const addOther = () => {
    const n = Number(other);
    if (Number.isInteger(n) && n >= 0 && n <= 60) tap(n);
    setOther("");
  };

  async function save() {
    const at = nowMs();
    const payload = buildReadingPost({ station, direction, slots, seenAt: seenAt ?? at, now: at });
    if (!payload) return;
    setStatus({ kind: "busy" });
    const result = await postReading(payload, { deviceId: deviceId() });
    if (result.kind === "limit") {
      track("submit_reading", { station, line, direction, status: "rate_limited" });
      return setStatus({ kind: "limit" });
    }
    if (result.kind === "error") return setStatus({ kind: "error" });
    const obs = localObservation(payload, line, result.id);
    rememberMyReading(obs, at);
    track("submit_reading", { station, line, direction, status: result.kind });
    track("log_reading", { station, line, direction, trains: Math.min(3, payload.minutes.length) });
    setStatus({ kind: "saved", pending: result.kind === "pending", obs, id: result.id, until: at + UNDO_MS });
    setSlots(emptySlots());
    setThird(false);
    setSeenAt(null);
    setEditTime(false);
    setOpen(false);
    onSaved?.(obs, result.kind);
  }

  async function undo() {
    if (status.kind !== "saved") return;
    const { obs, id } = status;
    setStatus({ kind: "undone" });
    forgetMyReading(obs, nowMs());
    if (id != null) await undoReading(id, { deviceId: deviceId() });
    onUndone?.(obs);
  }

  const shownNow = now || 0;
  const seenLabel = clock(seenAt ?? shownNow);
  const filled = slots.filter((v) => v != null).length;
  const slot = (i: number) => {
    const v = slots[i];
    return (
      <button
        type="button"
        onClick={() => (v == null ? setOpen(true) : setSlots((s) => clearSlot(s, i)))}
        aria-label={v == null ? t("entry.slotEmpty", { n: i + 1 }) : t("entry.clearSlot", { n: v })}
        className={`led inline-flex h-11 min-w-12 items-center justify-center rounded-lg border px-2 text-2xl font-bold ${v == null ? "border-dashed border-line text-muted" : "border-led"}`}
      >
        {v ?? "–"}
        {v != null && <X size={12} aria-hidden className="ml-1 opacity-60" />}
      </button>
    );
  };

  return (
    <div className="mt-3 rounded-xl border border-line bg-bg/40 p-3" data-quick-entry={`${station}:${direction}`}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        <span className="text-muted">{t("entry.boardSays")}</span>
        <span>{t("entry.next", { dest: destination })}</span>
        {slot(0)}
        <span>{t("unit.min")},</span>
        <span>{t("entry.then")}</span>
        {slot(1)}
        <span>{t("unit.min")}</span>
        {third ? (
          <>
            <span>{t("entry.then")}</span>
            {slot(2)}
            <span>{t("unit.min")}</span>
          </>
        ) : (
          <button type="button" className="text-xs text-accent underline" onClick={() => setThird(true)}>
            {t("entry.addThird")}
          </button>
        )}
      </p>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-8 gap-1.5" role="group" aria-label={t("entry.tapHint")}>
            {CHIP_MINUTES.map((m) => (
              <button key={m} type="button" onClick={() => tap(m)} className="btn btn-secondary h-11 min-w-0 px-0 text-lg tabular">
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2 text-muted">
              {t("entry.other")}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addOther()}
                className="field w-20 py-1.5"
              />
            </label>
            <button type="button" className="btn btn-secondary px-3 py-1.5 text-sm" onClick={addOther} disabled={other === ""}>
              {t("entry.add")}
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary min-h-11 px-5" disabled={!filled || status.kind === "busy"} onClick={() => void save()}>
          {t("entry.save")}
        </button>
        {!open && !filled && (
          <button type="button" className="text-sm text-accent underline" onClick={() => setOpen(true)}>
            {t("entry.tapHint")}
          </button>
        )}
        <span className="text-xs text-muted">
          {t("entry.seenAt", { time: seenLabel })} ·{" "}
          <button type="button" className="text-accent underline" onClick={() => setEditTime((v) => !v)} aria-expanded={editTime}>
            {t("entry.change")}
          </button>
        </span>
      </div>
      {editTime && shownNow > 0 && (
        <label className="mt-2 flex items-center gap-2 text-sm text-muted">
          {t("entry.seenAtLabel")}
          <input
            type="time"
            className="field w-32 py-1.5"
            value={seenLabel}
            min={clock(shownNow - MAX_SEEN_AGO_MIN * MINUTE)}
            max={clock(shownNow)}
            onChange={(e) => {
              if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
              let at = sgtInstant(sgtDate(shownNow), e.target.value);
              if (at > shownNow + MINUTE) at -= 24 * 60 * MINUTE; // just after midnight
              setSeenAt(clampSeenAt(at, nowMs()));
            }}
          />
        </label>
      )}

      {status.kind === "saved" && (
        <div role="status" className="mt-3 flex items-center gap-3 rounded-lg bg-go/10 px-3 py-2 text-sm">
          <span className="flex-1 text-go">{t(status.pending ? "entry.savedPending" : "entry.saved")}</span>
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
