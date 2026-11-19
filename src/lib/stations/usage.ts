import { LINE_CODES, PLATFORMS, type Station } from "@/lib/network";
import { filterStations, sortAlphabetical, sortFrequent, sortNearby } from "./list";

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

/** Pure: returns true if there is any station usage history (pins or recorded uses). */
export function hasStationUsage(usage: StationUsageState | null | undefined): boolean {
  if (!usage) return false;
  if (Array.isArray(usage.pins) && usage.pins.length > 0) return true;
  if (usage.stations && typeof usage.stations === "object") {
    return Object.values(usage.stations).some((r) => Boolean(r && (r.count > 0 || r.lastUsed > 0)));
  }
  return false;
}

/** Pure: determines the initial active tab for the stations list (defaults to frequent view). */
export function defaultStationTab(_usage?: StationUsageState | null | undefined): "frequent" | "line" {
  return "frequent";
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

/* ---------- Stations Tab Section Builder & Direction Ordering (t8) ---------- */

export type StationSectionMode = "frequent" | "near" | "az" | "line";

export interface StationSection {
  id: "pinned" | "recent" | "all" | "search";
  title: string;
  titleKey: "stations.section.pinned" | "stations.section.recent" | "stations.section.all" | "stations.section.search";
  stations: Station[];
}

export interface BuildStationSectionsParams {
  stations: Station[];
  pins?: Array<string | Station>;
  recent?: Array<string | Station>;
  mode?: StationSectionMode | string;
  query?: string;
  locale?: "en" | "zh-Hant";
  nearOrder?: string[] | null;
  frequentSlugs?: string[];
}

/**
 * Pure function: builds deduplicated station sections for the Stations tab.
 * Guarantees that no station appears more than once across all returned sections in ANY mode.
 */
export function buildStationSections({
  stations = [],
  pins = [],
  recent = [],
  mode = "frequent",
  query = "",
  locale = "en",
  nearOrder = null,
  frequentSlugs = [],
}: BuildStationSectionsParams): StationSection[] {
  const stationMap = new Map<string, Station>();
  for (const s of stations) {
    if (s && s.slug && !stationMap.has(s.slug)) {
      stationMap.set(s.slug, s);
    }
  }

  const toSlug = (item: string | Station): string =>
    typeof item === "string" ? item : item?.slug;

  const pinSlugs = (pins ?? []).map(toSlug).filter(Boolean);
  const recentSlugs = (recent ?? []).map(toSlug).filter(Boolean);

  // Search mode: query is non-empty -> single flat list, each station once
  if (query && query.trim().length > 0) {
    const filtered = filterStations(stations, query);
    const seen = new Set<string>();
    const uniqueStations: Station[] = [];
    for (const s of filtered) {
      if (!seen.has(s.slug)) {
        seen.add(s.slug);
        uniqueStations.push(s);
      }
    }
    return [
      {
        id: "search",
        title: locale === "zh-Hant" ? "搜尋結果" : "Search results",
        titleKey: "stations.section.search",
        stations: uniqueStations,
      },
    ];
  }

  // A–Z mode: one flat list, pinned stations just show filled star in place (no extra Pinned section)
  if (mode === "az") {
    const sorted = sortAlphabetical(stations, locale);
    const seen = new Set<string>();
    const uniqueStations: Station[] = [];
    for (const s of sorted) {
      if (!seen.has(s.slug)) {
        seen.add(s.slug);
        uniqueStations.push(s);
      }
    }
    return [
      {
        id: "all",
        title: locale === "zh-Hant" ? "所有車站" : "All stations",
        titleKey: "stations.section.all",
        stations: uniqueStations,
      },
    ];
  }

  // Near me mode: one flat list, pinned stations just show filled star in place (no extra Pinned section)
  if (mode === "near") {
    const sorted = sortNearby(stations, nearOrder, locale);
    const seen = new Set<string>();
    const uniqueStations: Station[] = [];
    for (const s of sorted) {
      if (!seen.has(s.slug)) {
        seen.add(s.slug);
        uniqueStations.push(s);
      }
    }
    return [
      {
        id: "all",
        title: locale === "zh-Hant" ? "所有車站" : "All stations",
        titleKey: "stations.section.all",
        stations: uniqueStations,
      },
    ];
  }

  // By line mode: one flat list along MRT lines without duplicate stations
  if (mode === "line") {
    const seen = new Set<string>();
    const lineOrdered: Station[] = [];
    for (const line of LINE_CODES) {
      const linePlatforms = Object.values(PLATFORMS)
        .filter((p) => p.line === line)
        .sort((a, b) => a.order - b.order);
      for (const p of linePlatforms) {
        if (!seen.has(p.station)) {
          seen.add(p.station);
          const s = stationMap.get(p.station);
          if (s) lineOrdered.push(s);
        }
      }
    }
    for (const s of stations) {
      if (!seen.has(s.slug)) {
        seen.add(s.slug);
        lineOrdered.push(s);
      }
    }
    return [
      {
        id: "all",
        title: locale === "zh-Hant" ? "所有車站" : "All stations",
        titleKey: "stations.section.all",
        stations: lineOrdered,
      },
    ];
  }

  // Default / Frequent mode:
  // "Pinned" section (only if any)
  // "Recent" section (only if any, excluding pinned)
  // "All stations" heading -> the rest of the stations EXCLUDING pinned and recent ones.
  const sections: StationSection[] = [];
  const claimedSlugs = new Set<string>();

  // 1. Pinned section (only if any)
  const pinnedList: Station[] = [];
  for (const slug of pinSlugs) {
    if (!claimedSlugs.has(slug) && stationMap.has(slug)) {
      claimedSlugs.add(slug);
      pinnedList.push(stationMap.get(slug)!);
    }
  }
  if (pinnedList.length > 0) {
    sections.push({
      id: "pinned",
      title: locale === "zh-Hant" ? "已釘選" : "Pinned",
      titleKey: "stations.section.pinned",
      stations: pinnedList,
    });
  }

  // 2. Recent section (only if any, excluding pinned)
  const recentList: Station[] = [];
  for (const slug of recentSlugs) {
    if (!claimedSlugs.has(slug) && stationMap.has(slug)) {
      claimedSlugs.add(slug);
      recentList.push(stationMap.get(slug)!);
    }
  }
  if (recentList.length > 0) {
    sections.push({
      id: "recent",
      title: locale === "zh-Hant" ? "最近造訪" : "Recent",
      titleKey: "stations.section.recent",
      stations: recentList,
    });
  }

  // 3. All stations section (excluding pinned and recent ones)
  const remaining = stations.filter((s) => !claimedSlugs.has(s.slug));
  const sortedRemaining = sortFrequent(remaining, frequentSlugs, locale);
  const seenRemaining = new Set<string>();
  const finalRemaining: Station[] = [];
  for (const s of sortedRemaining) {
    if (!seenRemaining.has(s.slug)) {
      seenRemaining.add(s.slug);
      finalRemaining.push(s);
    }
  }

  sections.push({
    id: "all",
    title: locale === "zh-Hant" ? "所有車站" : "All stations",
    titleKey: "stations.section.all",
    stations: finalRemaining,
  });

  return sections;
}

/**
 * Pure function: deduplicates and orders platforms and direction blocks for a station page.
 * 1. Ensures every line/direction appears at most once (no duplicates).
 * 2. Orders the directions so the direction the owner uses most is first:
 *    - For Outram Park (EW16 / TE17 / NE3):
 *      - Morning (before 14:00): EWL towards Pasir Ris & TEL towards Bayshore first; NEL last.
 *      - Evening (14:00+): TEL towards Woodlands North & EWL towards Tuas Link first; NEL last.
 *    - For Tiong Bahru (EW17):
 *      - Morning (before 14:00): towards Pasir Ris first.
 *      - Evening (14:00+): towards Tuas Link first.
 *    - For Shenton Way (TE19):
 *      - Evening (14:00+): towards Woodlands North first.
 *      - Morning (before 14:00): towards Bayshore first.
 */
export function orderStationPlatforms<
  P extends {
    code: string;
    line: string;
    directions: D[];
  },
  D extends {
    key: string;
    terminal?: string;
    [k: string]: unknown;
  }
>(platforms: P[], slug?: string, now: number = Date.now()): P[] {
  const seenLineDirections = new Set<string>();
  const sgtHour = new Date(now + 8 * 60 * 60 * 1000).getUTCHours();
  const isMorning = sgtHour < 14;

  const dedupedPlatforms = platforms.map((p) => {
    const dedupedDirs: D[] = [];
    for (const d of p.directions) {
      const lineDirKey = `${p.line}:${d.key}`;
      if (!seenLineDirections.has(lineDirKey)) {
        seenLineDirections.add(lineDirKey);
        dedupedDirs.push(d);
      }
    }

    const sortedDirs = [...dedupedDirs].sort((a, b) => {
      if (slug === "outram-park") {
        if (p.line === "EW" || p.line === "EWL") {
          const isEastA = a.key === "TO_EAST" || a.terminal === "EW1" || a.terminal === "Pasir Ris";
          const isEastB = b.key === "TO_EAST" || b.terminal === "EW1" || b.terminal === "Pasir Ris";
          if (isEastA !== isEastB) return isMorning ? (isEastA ? -1 : 1) : (isEastA ? 1 : -1);
        }
        if (p.line === "TE" || p.line === "TEL") {
          const isSouthA = a.key === "TO_SOUTH" || a.terminal === "TE29" || a.terminal === "Bayshore";
          const isSouthB = b.key === "TO_SOUTH" || b.terminal === "TE29" || b.terminal === "Bayshore";
          if (isSouthA !== isSouthB) return isMorning ? (isSouthA ? -1 : 1) : (isSouthA ? 1 : -1);
        }
      } else if (slug === "tiong-bahru") {
        const isEastA = a.key === "TO_EAST" || a.terminal === "EW1" || a.terminal === "Pasir Ris";
        const isEastB = b.key === "TO_EAST" || b.terminal === "EW1" || b.terminal === "Pasir Ris";
        if (isEastA !== isEastB) return isMorning ? (isEastA ? -1 : 1) : (isEastA ? 1 : -1);
      } else if (slug === "shenton-way") {
        const isNorthA = a.key === "TO_NORTH" || a.terminal === "TE1" || a.terminal === "Woodlands North";
        const isNorthB = b.key === "TO_NORTH" || b.terminal === "TE1" || b.terminal === "Woodlands North";
        if (isNorthA !== isNorthB) return isMorning ? (isNorthA ? 1 : -1) : (isNorthA ? -1 : 1);
      }
      return 0;
    });

    return {
      ...p,
      directions: sortedDirs,
    };
  });

  if (slug === "outram-park") {
    dedupedPlatforms.sort((a, b) => {
      const isNeA = a.line === "NE" || a.line === "NEL";
      const isNeB = b.line === "NE" || b.line === "NEL";
      if (isNeA) return 1;
      if (isNeB) return -1;

      const isEwA = a.line === "EW" || a.line === "EWL";
      const isTeB = b.line === "TE" || b.line === "TEL";
      if (isEwA && isTeB) return isMorning ? -1 : 1;

      const isTeA = a.line === "TE" || a.line === "TEL";
      const isEwB = b.line === "EW" || b.line === "EWL";
      if (isTeA && isEwB) return isMorning ? 1 : -1;
      return 0;
    });
  }

  return dedupedPlatforms;
}
