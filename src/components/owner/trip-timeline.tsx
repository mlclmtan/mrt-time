"use client";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deriveSegments, segmentTotals } from "@/lib/journey/timeline";
import { getDirection, getPlatform, LINES, stationForCode } from "@/lib/network";
import { NOW_CHOICE, resolveTime, type TimeChoice } from "@/lib/sightings/client";
import { TRIP_KINDS } from "@/lib/analytics/events";
import { randomId } from "@/lib/analytics/client";
import { clock } from "@/lib/format";
import { nowMs } from "@/lib/time";
import type { DictKey } from "@/lib/i18n";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { TimeChips } from "../boarding/time-chips";
import { PlatformPicker, type PlatformChoice } from "../boarding/platform-picker";

export type TimelineItem = { id: number; kind: string; at: number; station: string | null; line: string | null; direction: string | null };
type TripKind = (typeof TRIP_KINDS)[number];
const NEEDS_PLATFORM = new Set(["at_platform", "board", "alight", "tap_in", "tap_out"]);
export const kindLabel = (kind: string) => `kind.${kind}` as DictKey;

/**
 * Today's taps in order with the minutes between them (waiting, riding,
 * changing, walking). Edit a time, delete a tap, or add one you missed;
 * the train sighting behind a boarding follows every change.
 */
export function TripTimeline({ events, onChanged }: { events: TimelineItem[]; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { track } = useAnalytics();
  const [editing, setEditing] = useState<number | null>(null);
  const [editTime, setEditTime] = useState<TimeChoice>(NOW_CHOICE);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [addKind, setAddKind] = useState<TripKind>("board");
  const [addPlatform, setAddPlatform] = useState<PlatformChoice | null>(null);
  const [addTime, setAddTime] = useState<TimeChoice>({ kind: "ago", minutes: 5 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const tick = () => setNow(nowMs());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const sorted = [...events].sort((a, b) => a.at - b.at);
  const segments = deriveSegments(sorted);
  const totals = segmentTotals(segments);

  async function call(url: string, init: RequestInit) {
    setBusy(true);
    setError(false);
    const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } }).catch(() => null);
    setBusy(false);
    if (!res?.ok) setError(true);
    onChanged();
    return Boolean(res?.ok);
  }

  async function saveTime(e: TimelineItem) {
    const at = resolveTime(editTime, nowMs());
    if (await call("/api/trip-events", { method: "PATCH", body: JSON.stringify({ id: e.id, at: new Date(at).toISOString() }) })) {
      track("timeline_edit", { action: "edit_time", kind: e.kind as TripKind });
      setEditing(null);
    }
  }
  async function remove(e: TimelineItem) {
    if (await call(`/api/trip-events?id=${e.id}`, { method: "DELETE" })) track("timeline_edit", { action: "delete", kind: e.kind as TripKind });
    setConfirmDelete(null);
  }
  async function add() {
    const at = resolveTime(addTime, nowMs());
    const platform = addPlatform && NEEDS_PLATFORM.has(addKind) ? getPlatform(addPlatform.station) : undefined;
    const body = {
      clientId: randomId(),
      kind: addKind,
      at: new Date(at).toISOString(),
      ...(platform && addPlatform ? { station: platform.code, line: platform.line, direction: addPlatform.direction } : {}),
    };
    if (await call("/api/trip-events", { method: "POST", body: JSON.stringify(body) })) {
      track("timeline_edit", { action: "add_missed", kind: addKind });
      setAdding(false);
    }
  }

  return (
    <div className="space-y-3" data-clarity-mask="True">
      {sorted.length === 0 ? (
        <p className="text-sm text-muted">{t("timeline.empty")}</p>
      ) : (
        <>
          <p className="text-xs text-muted">
            {t("timeline.totals", { walk: totals.walk, wait: totals.wait, ride: totals.ride, change: totals.change })}
          </p>
          <ol className="space-y-1">
            {sorted.map((e, i) => {
              const platform = e.station ? getPlatform(e.station) : undefined;
              const station = e.station ? stationForCode(e.station) : undefined;
              const dir = platform && e.direction ? getDirection(platform.line, e.direction) : undefined;
              const seg = segments.find((s) => s.to === i);
              return (
                <li key={e.id}>
                  {seg && (
                    <div className="ml-14 border-l border-dashed border-line py-1 pl-3 text-xs text-muted">
                      {t(`timeline.seg.${seg.kind}` as DictKey, { n: seg.minutes })}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="led tabular w-12">{clock(e.at)}</span>
                    <span className="font-semibold">{t(kindLabel(e.kind))}</span>
                    {platform && (
                      <span className="chip text-[10px] text-white" style={{ background: LINES[platform.line].color }}>
                        {platform.code}
                      </span>
                    )}
                    {station && <span>{station.name[locale]}</span>}
                    {dir && <span className="text-muted">→ {dir.board[locale]}</span>}
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        aria-label={t("timeline.editTime")}
                        className="text-muted"
                        onClick={() => {
                          setEditing(editing === e.id ? null : e.id);
                          setEditTime({ kind: "pick", clock: clock(e.at) });
                        }}
                      >
                        <Pencil size={14} aria-hidden />
                      </button>
                      {confirmDelete === e.id ? (
                        <button type="button" className="text-xs font-semibold text-bad" disabled={busy} onClick={() => void remove(e)}>
                          {t("timeline.confirmDelete")}
                        </button>
                      ) : (
                        <button type="button" aria-label={t("timeline.delete")} className="text-muted" onClick={() => setConfirmDelete(e.id)}>
                          <Trash2 size={14} aria-hidden />
                        </button>
                      )}
                    </span>
                  </div>
                  {editing === e.id && (
                    <div className="mt-2 ml-14 space-y-2">
                      <TimeChips value={editTime} onChange={setEditTime} now={now} />
                      <div className="flex gap-2">
                        <button type="button" className="btn btn-primary px-3 py-1 text-sm" disabled={busy} onClick={() => void saveTime(e)}>
                          {t("common.save")}
                        </button>
                        <button type="button" className="btn btn-secondary px-3 py-1 text-sm" onClick={() => setEditing(null)}>
                          {t("timeline.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      {error && <p className="text-sm text-bad">{t("reading.error")}</p>}
      {adding ? (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <label className="flex items-center gap-2 text-sm">
            {t("timeline.what")}
            <select className="field w-auto" value={addKind} onChange={(e) => setAddKind(e.target.value as TripKind)}>
              {TRIP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(kindLabel(k))}
                </option>
              ))}
            </select>
          </label>
          {NEEDS_PLATFORM.has(addKind) && <PlatformPicker value={addPlatform} onChange={setAddPlatform} surface="home" />}
          <TimeChips value={addTime} onChange={setAddTime} now={now} />
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary px-3 py-1.5 text-sm" disabled={busy} onClick={() => void add()}>
              {t("timeline.addSave")}
            </button>
            <button type="button" className="btn btn-secondary px-3 py-1.5 text-sm" onClick={() => setAdding(false)}>
              {t("timeline.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="inline-flex items-center gap-1 text-sm text-accent underline" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden /> {t("timeline.addMissed")}
        </button>
      )}
    </div>
  );
}
