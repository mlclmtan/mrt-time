/**
 * Stale-while-revalidate client snapshot cache for route and station data.
 * Keys in localStorage follow: mrt:snap:v1:<route-key>
 */

export const SNAPSHOT_PREFIX = "mrt:snap:v1:";

export type SnapshotRecord<T> = {
  data: T;
  savedAt: number;
};

export function cacheKey(routeKey: string): string {
  return `${SNAPSHOT_PREFIX}${routeKey}`;
}

export function safeParseSnapshot<T>(raw: string | null): SnapshotRecord<T> | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof (parsed as SnapshotRecord<T>).savedAt !== "number" || isNaN((parsed as SnapshotRecord<T>).savedAt)) {
      return null;
    }
    if (!("data" in parsed) || (parsed as SnapshotRecord<T>).data === undefined) {
      return null;
    }
    return parsed as SnapshotRecord<T>;
  } catch {
    return null;
  }
}

export function getSnapshot<T>(routeKey: string): SnapshotRecord<T> | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(routeKey));
    return safeParseSnapshot<T>(raw);
  } catch {
    return null;
  }
}

export function saveSnapshot<T>(routeKey: string, data: T, savedAt: number = Date.now()): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const record: SnapshotRecord<T> = { data, savedAt };
    window.localStorage.setItem(cacheKey(routeKey), JSON.stringify(record));
  } catch {
    // Quota exceeded or private browsing restrictions
  }
}

export function clearSnapshot(routeKey: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.removeItem(cacheKey(routeKey));
  } catch {
    // Ignore
  }
}

export function isFresh(savedAt: number, now: number = Date.now(), maxAgeMs: number = 2 * 60 * 1000): boolean {
  if (typeof savedAt !== "number" || isNaN(savedAt)) return false;
  const age = now - savedAt;
  return age >= 0 && age <= maxAgeMs;
}

export function ageLabel(
  savedAt: number,
  now: number = Date.now(),
  locale: "en" | "zh-Hant" = "en",
): string | null {
  if (typeof savedAt !== "number" || isNaN(savedAt)) return null;
  const age = now - savedAt;
  if (age <= 2 * 60 * 1000) return null;
  const min = Math.max(1, Math.round(age / 60_000));
  if (age <= 30 * 60 * 1000) {
    return locale === "zh-Hant" ? `更新於 ${min} 分鐘前` : `Updated ${min} min ago`;
  }
  return locale === "zh-Hant" ? `離線快照 · ${min} 分鐘前` : `Offline copy · ${min} min old`;
}
