/**
 * "I boarded" / "Got off" on the device: the time chips (Now · −1 · −2 · −5
 * min · Pick time, back up to 12 h, SGT) and the calls to /api/sightings.
 */
import { MINUTE, sgtDate, sgtInstant } from "../time";

export const TIME_CHIPS = [0, 1, 2, 5] as const;
export const MAX_BACKDATE_MIN = 12 * 60;
export const UNDO_MS = 10_000;

export type TimeChoice = { kind: "ago"; minutes: number } | { kind: "pick"; clock: string };
export const NOW_CHOICE: TimeChoice = { kind: "ago", minutes: 0 };

/** The instant a choice means at `now`. A picked clock later than now is yesterday's. Never > 12 h back. */
export function resolveTime(choice: TimeChoice, now: number): number {
  let at: number;
  if (choice.kind === "ago") at = now - choice.minutes * MINUTE;
  else {
    if (!/^\d{2}:\d{2}$/.test(choice.clock)) return now;
    at = sgtInstant(sgtDate(now), choice.clock);
    if (at > now + MINUTE) at -= 24 * 60 * MINUTE;
  }
  return Math.min(now, Math.max(now - MAX_BACKDATE_MIN * MINUTE, at));
}

/** Whole minutes between the chosen time and now (0 = now), for analytics. */
export function minutesBack(at: number, now: number): number {
  return Math.max(0, Math.min(MAX_BACKDATE_MIN, Math.round((now - at) / MINUTE)));
}

export type SightingKindInput = "boarded" | "alighted";
export type SightingPost = { station: string; direction: string; kind: SightingKindInput; at: string };
export type SightingResult =
  | { kind: "approved" | "pending"; id: number | null; clientId: string | null }
  | { kind: "limit" }
  | { kind: "error" };

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function buildSightingPost(input: { station: string; direction: string; kind: SightingKindInput; at: number }): SightingPost {
  return { station: input.station, direction: input.direction, kind: input.kind, at: new Date(input.at).toISOString() };
}

/** POST /api/sightings. The device id (consented visitors only) rides in a header. */
export async function postSighting(payload: SightingPost, opts: { fetch?: FetchLike; deviceId?: string | null } = {}): Promise<SightingResult> {
  const doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.deviceId) headers["x-device-id"] = opts.deviceId;
  try {
    const res = await doFetch("/api/sightings", { method: "POST", headers, body: JSON.stringify(payload) });
    if (res.status === 429) return { kind: "limit" };
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as { status?: string; id?: number | null; clientId?: string | null };
    return { kind: body.status === "approved" ? "approved" : "pending", id: body.id ?? null, clientId: body.clientId ?? null };
  } catch {
    return { kind: "error" };
  }
}

/** The 10-second undo: by clientId (owner) or id (visitor, same device/network). */
export async function undoSighting(ref: { id: number | null; clientId: string | null }, opts: { fetch?: FetchLike; deviceId?: string | null } = {}) {
  const doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
  const q = ref.clientId ? `clientId=${encodeURIComponent(ref.clientId)}` : ref.id != null ? `id=${ref.id}` : null;
  if (!q) return false;
  const headers: Record<string, string> = {};
  if (opts.deviceId) headers["x-device-id"] = opts.deviceId;
  const res = await doFetch(`/api/sightings?${q}`, { method: "DELETE", headers }).catch(() => null);
  return Boolean(res?.ok);
}
