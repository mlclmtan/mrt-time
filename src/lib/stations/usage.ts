/**
 * Station usage tracking, ranking and pin management (localStorage + pure logic).
 * SSR-safe: falls back gracefully on the server or when storage is unavailable.
 */

export type StationUsageKind = "view" | "reading" | "boarding";

export type StationUse = {
  timestamp: number;
  kind?: StationUsageKind;
};

export type StationRecord = {
  count: number;
  lastUsed: number;
  uses?: StationUse[];
};

export type StationUsageState = {
  stations: Record<string, StationRecord>;
  pins: string[];
};

export const MAX_PINS = 3;
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const USAGE_STORAGE_KEY = "mrt_station_usage";
export const USAGE_CHANGE_EVENT = "mrt-station-usage-change";

export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const getStore = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

export function getInitialUsage(): StationUsageState {
  return { stations: {}, pins: [] };
}

function isUsageState(u: StationUsageState | Record<string, StationRecord>): u is StationUsageState {
  return typeof u === "object" && u !== null && "stations" in u && typeof (u as StationUsageState).stations === "object";
}

function getStationRecords(usage: StationUsageState | Record<string, StationRecord>): Record<string, StationRecord> {
  if (!usage) return {};
  if (isUsageState(usage)) {
    return usage.stations ?? {};
  }
  return usage;
}

/** Pure: records a station use and returns a new state object. */
export function recordUse(
  state: StationUsageState,
  slug: string,
  timestamp: number = Date.now(),
  kind: StationUsageKind = "view"
): StationUsageState {
  const stations = { ...(state?.stations ?? {}) };
  const current = stations[slug] ?? { count: 0, lastUsed: 0, uses: [] };
  const currentUses = Array.isArray(current.uses) ? current.uses : [];

  // Retain up to 90 days of granular uses for decay calculation.
  const cutoff = timestamp - 3 * THIRTY_DAYS_MS;
  const filteredUses = currentUses.filter((u) => u.timestamp >= cutoff);
  const updatedUses = [...filteredUses, { timestamp, kind }];

  stations[slug] = {
    count: current.count + 1,
    lastUsed: Math.max(current.lastUsed, timestamp),
    uses: updatedUses,
  };

  return {
    pins: Array.isArray(state?.pins) ? [...state.pins] : [],
    stations,
  };
}

/** Pure: toggles pin status for a station slug (max 3 pinned). */
export function togglePin(state: StationUsageState, slug: string): StationUsageState {
  const pins = Array.isArray(state?.pins) ? [...state.pins] : [];
  const idx = pins.indexOf(slug);

  if (idx >= 0) {
    pins.splice(idx, 1);
    return {
      stations: { ...(state?.stations ?? {}) },
      pins,
    };
  }

  if (pins.length >= MAX_PINS) {
    return state;
  }

  pins.push(slug);
  return {
    stations: { ...(state?.stations ?? {}) },
    pins,
  };
}

/** Pure: checks if a slug is pinned. */
export function isPinned(state: StationUsageState, slug: string): boolean {
  return Boolean(state?.pins?.includes(slug));
}

/**
 * Pure: calculates frequency score with 30-day half-life recency decay.
 * If individual use timestamps exist, each use decays by 0.5^(age / 30d).
 * Otherwise the overall count decays from lastUsed.
 */
export function scoreStation(record: StationRecord, now: number): number {
  if (!record || record.count <= 0) return 0;

  if (Array.isArray(record.uses) && record.uses.length > 0) {
    const usesScore = record.uses.reduce((acc, u) => {
      const ageMs = Math.max(0, now - u.timestamp);
      return acc + Math.pow(0.5, ageMs / THIRTY_DAYS_MS);
    }, 0);

    const extra = Math.max(0, record.count - record.uses.length);
    if (extra > 0) {
      const oldestKept = record.uses[0]?.timestamp ?? record.lastUsed;
      const extraAgeMs = Math.max(0, now - oldestKept);
      return usesScore + extra * Math.pow(0.5, extraAgeMs / THIRTY_DAYS_MS);
    }
    return usesScore;
  }

  const ageMs = Math.max(0, now - record.lastUsed);
  return record.count * Math.pow(0.5, ageMs / THIRTY_DAYS_MS);
}

/**
 * Pure: ranks stations by frequency score (count with 30-day recency decay).
 * Returns station slugs in descending score order.
 */
export function rankFrequent(
  usage: StationUsageState | Record<string, StationRecord>,
  now: number = Date.now()
): string[] {
  const records = getStationRecords(usage);
  const scored = Object.entries(records)
    .filter(([, r]) => r && r.count > 0)
    .map(([slug, r]) => ({
      slug,
      score: scoreStation(r, now),
      lastUsed: r.lastUsed,
    }))
    .filter((item) => item.score > 0);

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 1e-6) {
      return b.score - a.score;
    }
    if (b.lastUsed !== a.lastUsed) {
      return b.lastUsed - a.lastUsed;
    }
    return a.slug.localeCompare(b.slug);
  });

  return scored.map((item) => item.slug);
}

/**
 * Pure: returns the `n` most recently used station slugs, sorted newest first.
 * Optionally excludes specified slugs (e.g. pinned stations).
 */
export function recent(
  usage: StationUsageState | Record<string, StationRecord>,
  n: number = 5,
  exclude: string[] = []
): string[] {
  const records = getStationRecords(usage);
  const excludeSet = new Set(exclude);

  const valid = Object.entries(records).filter(
    ([slug, r]) => r && r.lastUsed > 0 && !excludeSet.has(slug)
  );

  valid.sort(([, a], [, b]) => b.lastUsed - a.lastUsed);

  return valid.slice(0, n).map(([slug]) => slug);
}

/* ---------- LocalStorage Wrappers (SSR-Safe) ---------- */

export function loadUsage(s: Store | null = getStore()): StationUsageState {
  try {
    const raw = s?.getItem(USAGE_STORAGE_KEY);
    if (!raw) return getInitialUsage();
    const parsed = JSON.parse(raw);
    const stations =
      typeof parsed?.stations === "object" && parsed.stations !== null ? parsed.stations : {};
    const pins = Array.isArray(parsed?.pins)
      ? parsed.pins.filter((p: unknown): p is string => typeof p === "string").slice(0, MAX_PINS)
      : [];
    return { stations, pins };
  } catch {
    return getInitialUsage();
  }
}

export function saveUsage(state: StationUsageState, s: Store | null = getStore()): void {
  try {
    s?.setItem(USAGE_STORAGE_KEY, JSON.stringify(state));
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new Event(USAGE_CHANGE_EVENT));
    }
  } catch {
    // Quota exceeded or private browsing restrictions
  }
}

export function recordStationUse(
  slug: string,
  timestamp: number = Date.now(),
  kind: StationUsageKind = "view",
  s: Store | null = getStore()
): StationUsageState {
  const current = loadUsage(s);
  const next = recordUse(current, slug, timestamp, kind);
  saveUsage(next, s);
  return next;
}

export function toggleStationPin(slug: string, s: Store | null = getStore()): StationUsageState {
  const current = loadUsage(s);
  const next = togglePin(current, slug);
  saveUsage(next, s);
  return next;
}
