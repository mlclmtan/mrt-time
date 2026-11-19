import type { Locale } from "@/lib/i18n";
import { LINES, LINE_CODES, PLATFORMS, STATIONS, type LineCode, type Station } from "@/lib/network";

export type StationTab = "frequent" | "near" | "az" | "line";

/** Matches station by English name, Traditional Chinese name, code (prefix or exact), or slug. */
export function filterStations(stations: Station[], query: string): Station[] {
  const q = query.trim().toLowerCase();
  if (!q) return stations;
  return stations.filter((s) => {
    if (s.name.en.toLowerCase().includes(q)) return true;
    if (s.name["zh-Hant"].includes(query.trim())) return true;
    if (s.slug.toLowerCase().includes(q)) return true;
    if (s.codes.some((c) => c.toLowerCase().includes(q))) return true;
    return false;
  });
}

/** Sorts stations alphabetically by primary name for the given locale. */
export function sortAlphabetical(stations: Station[], locale: Locale = "en"): Station[] {
  return [...stations].sort((a, b) => {
    const nameA = a.name[locale] || a.name.en;
    const nameB = b.name[locale] || b.name.en;
    return nameA.localeCompare(nameB, locale === "zh-Hant" ? "zh-Hant" : "en");
  });
}

/** Sorts stations: frequent stations first (by ranked frequentSlugs), then remaining A-Z. */
export function sortFrequent(stations: Station[], frequentSlugs: string[], locale: Locale = "en"): Station[] {
  if (!frequentSlugs.length) {
    return sortAlphabetical(stations, locale);
  }

  const rankMap = new Map<string, number>();
  frequentSlugs.forEach((slug, idx) => rankMap.set(slug, idx));

  return [...stations].sort((a, b) => {
    const rankA = rankMap.has(a.slug) ? rankMap.get(a.slug)! : Infinity;
    const rankB = rankMap.has(b.slug) ? rankMap.get(b.slug)! : Infinity;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const nameA = a.name[locale] || a.name.en;
    const nameB = b.name[locale] || b.name.en;
    return nameA.localeCompare(nameB, locale === "zh-Hant" ? "zh-Hant" : "en");
  });
}

/** Sorts stations by distance/order (e.g. from GPS hook), then remaining A-Z. */
export function sortNearby(stations: Station[], order: string[] | null, locale: Locale = "en"): Station[] {
  if (!order || !order.length) {
    return sortAlphabetical(stations, locale);
  }

  const orderMap = new Map<string, number>();
  order.forEach((slug, idx) => orderMap.set(slug, idx));

  return [...stations].sort((a, b) => {
    const rankA = orderMap.has(a.slug) ? orderMap.get(a.slug)! : Infinity;
    const rankB = orderMap.has(b.slug) ? orderMap.get(b.slug)! : Infinity;

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    const nameA = a.name[locale] || a.name.en;
    const nameB = b.name[locale] || b.name.en;
    return nameA.localeCompare(nameB, locale === "zh-Hant" ? "zh-Hant" : "en");
  });
}

export type LineGroup = {
  code: LineCode;
  color: string;
  name: { en: string; "zh-Hant": string };
  stations: Station[];
};

/** Groups stations by line according to their platform line order. */
export function getLineGroups(stationsList: Station[] = STATIONS): LineGroup[] {
  const stationMap = new Map(stationsList.map((s) => [s.slug, s]));

  return LINE_CODES.map((code) => {
    const linePlatforms = Object.values(PLATFORMS)
      .filter((p) => p.line === code)
      .sort((a, b) => a.order - b.order);

    const seen = new Set<string>();
    const stations: Station[] = [];

    for (const p of linePlatforms) {
      if (!seen.has(p.station)) {
        seen.add(p.station);
        const s = stationMap.get(p.station);
        if (s) stations.push(s);
      }
    }

    return {
      code,
      color: LINES[code].color,
      name: LINES[code].name,
      stations,
    };
  });
}

export { buildStationSections, orderStationPlatforms } from "./usage";
