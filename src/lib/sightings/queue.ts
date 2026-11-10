/**
 * Offline tap queue: a tap made with no connection (underground, flaky
 * signal) is kept in localStorage with its own tap time and posted when the
 * device is back online (or the page opens again). Only JSON POSTs to our
 * own logging endpoints; server errors (4xx) drop the item, network errors
 * keep it. At most 50 items, none older than 12 h.
 */
export const QUEUE_KEY = "mrt_tap_queue";
const MAX_ITEMS = 50;
const MAX_AGE_MS = 12 * 60 * 60_000;
const ALLOWED = new Set(["/api/trip-events", "/api/sightings"]);

export type QueuedTap = { id: string; url: string; body: unknown; queuedAt: number; headers?: Record<string, string> };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function read(storage: Storage): QueuedTap[] {
  try {
    const raw = JSON.parse(storage.getItem(QUEUE_KEY) ?? "[]") as QueuedTap[];
    return Array.isArray(raw) ? raw.filter((t) => t && ALLOWED.has(t.url)) : [];
  } catch {
    return [];
  }
}
function write(storage: Storage, items: QueuedTap[]) {
  storage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_ITEMS)));
}

export function queuedTaps(storage: Storage): QueuedTap[] {
  return read(storage);
}

export function enqueueTap(storage: Storage, tap: Omit<QueuedTap, "id" | "queuedAt">, now = Date.now()): QueuedTap | null {
  if (!ALLOWED.has(tap.url)) return null;
  const item: QueuedTap = { ...tap, id: `${now}-${Math.random().toString(36).slice(2, 8)}`, queuedAt: now };
  write(storage, [...read(storage), item]);
  return item;
}

/** Send queued taps oldest first. Returns how many were delivered (or rejected for good). */
export async function flushTaps(storage: Storage, doFetch: FetchLike, now = Date.now()): Promise<{ sent: number; left: number }> {
  const items = read(storage).filter((t) => now - t.queuedAt <= MAX_AGE_MS);
  const left: QueuedTap[] = [];
  let sent = 0;
  for (const [i, tap] of items.entries()) {
    try {
      const res = await doFetch(tap.url, { method: "POST", headers: { "content-type": "application/json", ...tap.headers }, body: JSON.stringify(tap.body) });
      // 5xx: try again later; anything else (ok, or a 4xx that will never pass) is done.
      if (res.status >= 500) left.push(tap);
      else sent++;
    } catch {
      // Still offline: keep this one and everything after it, in order.
      left.push(...items.slice(i));
      break;
    }
  }
  write(storage, left);
  return { sent, left: left.length };
}
