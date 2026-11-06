/**
 * One-tap board entry, shared by the station cards, owner Home and /add.
 * A commuter knows three things: which way the train goes, in how many
 * minutes, and when they saw it. The form posts exactly that:
 * { station, direction, minutes[], seenAt }.
 */
import { MINUTE } from "../time";
import type { Observation } from "../predict/types";

export type ReadingPost = { station: string; direction: string; minutes: number[]; seenAt: string };
export type SaveResult =
  | { kind: "approved" | "pending"; id: number | null; line: string }
  | { kind: "limit" }
  | { kind: "error" };

export const MAX_TRAINS = 3;
export const CHIP_MINUTES = Array.from({ length: 16 }, (_, i) => i); // 0–15
export const MAX_SEEN_AGO_MIN = 30;
export const UNDO_MS = 10_000;

export type Slots = (number | null)[];
export const emptySlots = (): Slots => [null, null, null];

/** Tapping a chip fills the next empty slot (the third train is optional). */
export function fillNextSlot(slots: Slots, minutes: number, limit = MAX_TRAINS): Slots {
  const next = [...slots];
  const i = next.findIndex((v, idx) => v == null && idx < limit);
  if (i === -1) return next;
  next[i] = Math.max(0, Math.min(60, Math.round(minutes)));
  return next;
}
export function clearSlot(slots: Slots, index: number): Slots {
  // Later trains shift up so the filled ones stay first.
  const kept = slots.filter((v, i) => i !== index && v != null);
  return [...kept, ...Array(MAX_TRAINS - kept.length).fill(null)];
}

/** "seen at" can be moved back up to 30 min, never into the future. */
export function clampSeenAt(seenAt: number, now: number): number {
  return Math.min(now, Math.max(now - MAX_SEEN_AGO_MIN * MINUTE, seenAt));
}

/** The body the form sends — these four keys and nothing else. */
export function buildReadingPost(input: { station: string; direction: string; slots: Slots; seenAt: number; now: number }): ReadingPost | null {
  const minutes = input.slots.filter((v): v is number => v != null).sort((a, b) => a - b).slice(0, MAX_TRAINS);
  if (!minutes.length || !input.station || !input.direction) return null;
  return {
    station: input.station,
    direction: input.direction,
    minutes,
    seenAt: new Date(clampSeenAt(input.seenAt, input.now)).toISOString(),
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** POST /api/readings. The device id (consented visitors only) rides in a header, not the body. */
export async function postReading(payload: ReadingPost, opts: { fetch?: FetchLike; deviceId?: string | null } = {}): Promise<SaveResult> {
  const doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.deviceId) headers["x-device-id"] = opts.deviceId;
  const res = await doFetch("/api/readings", { method: "POST", headers, body: JSON.stringify(payload) }).catch(() => null);
  if (!res) return { kind: "error" };
  if (res.status === 429) return { kind: "limit" };
  if (!res.ok) return { kind: "error" };
  const body = (await res.json().catch(() => null)) as { status?: string; id?: number | null; line?: string } | null;
  if (body?.status !== "approved" && body?.status !== "pending") return { kind: "error" };
  return { kind: body.status, id: body.id ?? null, line: body.line ?? "" };
}

export async function undoReading(id: number, opts: { fetch?: FetchLike; deviceId?: string | null } = {}) {
  const doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const headers: Record<string, string> = {};
  if (opts.deviceId) headers["x-device-id"] = opts.deviceId;
  const res = await doFetch(`/api/readings?id=${id}`, { method: "DELETE", headers }).catch(() => null);
  return Boolean(res?.ok);
}

/** The saved reading as an observation, for the optimistic card update. */
export function localObservation(payload: ReadingPost, line: string, id?: number | null): Observation {
  return {
    ...(id != null ? { id } : {}),
    station: payload.station,
    line,
    direction: payload.direction,
    capturedAt: Date.parse(payload.seenAt),
    minutes: payload.minutes,
    source: "public",
    status: "approved",
  };
}

/* ---------- This device's own recent readings (localStorage, 90 min) ---------- */

const MINE_KEY = "mrt_my_readings";
const LAST_STATION_KEY = "mrt_last_station";
const KEEP_MS = 90 * MINUTE;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

export function myReadings(now: number, s: Store | null = store()): Observation[] {
  try {
    const all = JSON.parse(s?.getItem(MINE_KEY) || "[]") as Observation[];
    return Array.isArray(all) ? all.filter((o) => now - o.capturedAt <= KEEP_MS && o.capturedAt <= now + MINUTE) : [];
  } catch {
    return [];
  }
}
export function rememberMyReading(obs: Observation, now: number, s: Store | null = store()) {
  const kept = myReadings(now, s).filter((o) => !(o.station === obs.station && o.direction === obs.direction));
  s?.setItem(MINE_KEY, JSON.stringify([...kept, obs].slice(-20)));
  s?.setItem(LAST_STATION_KEY, obs.station);
}
export function forgetMyReading(obs: Pick<Observation, "station" | "direction" | "capturedAt">, now: number, s: Store | null = store()) {
  const kept = myReadings(now, s).filter((o) => !(o.station === obs.station && o.direction === obs.direction && o.capturedAt === obs.capturedAt));
  s?.setItem(MINE_KEY, JSON.stringify(kept));
}
/** Latest own reading for a platform direction. */
export function myReadingFor(list: Observation[], station: string, direction: string): Observation | null {
  return list.filter((o) => o.station === station && o.direction === direction).sort((a, b) => b.capturedAt - a.capturedAt)[0] ?? null;
}
export function lastUsedStation(s: Store | null = store()): string | null {
  const v = s?.getItem(LAST_STATION_KEY);
  return v && /^[A-Z]{2}\d{1,2}$/.test(v) ? v : null;
}
