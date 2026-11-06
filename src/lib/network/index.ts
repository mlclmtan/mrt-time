import { sgtMinuteOfDay, MINUTES_PER_DAY } from "../time";
import {
  DEFAULT_TRANSFER_MIN,
  LINES,
  PLATFORMS,
  RIDE_MINUTES,
  STATIONS,
  type Direction,
  type Line,
  type LineCode,
  type Platform,
  type Station,
} from "./data";

export * from "./data";

export type Locale = "en" | "zh-Hant";

export const LINE_CODES = Object.keys(LINES) as LineCode[];

export function isLineCode(value: unknown): value is LineCode {
  return typeof value === "string" && value in LINES;
}
export function getLine(code: string): Line | undefined {
  return isLineCode(code) ? LINES[code] : undefined;
}
export function getPlatform(code: string): Platform | undefined {
  return PLATFORMS[code];
}
export function getStation(slug: string): Station | undefined {
  return STATIONS.find((s) => s.slug === slug);
}
export function stationForCode(code: string): Station | undefined {
  const p = PLATFORMS[code];
  return p ? getStation(p.station) : undefined;
}
export function getDirection(line: string, key: string): Direction | undefined {
  return getLine(line)?.directions[key];
}
export function isValidDirection(line: string, key: string) {
  return Boolean(getDirection(line, key));
}
/** Platforms of a line in running order. */
export function platformsOnLine(line: LineCode): Platform[] {
  return Object.values(PLATFORMS)
    .filter((p) => p.line === line)
    .sort((a, b) => a.order - b.order);
}

/** Which direction a train must run to go from one platform to another. */
export function directionBetween(fromCode: string, toCode: string): Direction | undefined {
  const a = PLATFORMS[fromCode];
  const b = PLATFORMS[toCode];
  if (!a || !b || a.line !== b.line || a.order === b.order) return undefined;
  const sense = b.order > a.order ? 1 : -1;
  return Object.values(LINES[a.line].directions).find((d) => d.sense === sense);
}

/** In-vehicle minutes: observed figure if known, else stops × default. */
export function rideMinutes(fromCode: string, toCode: string): number {
  const observed = RIDE_MINUTES[`${fromCode}>${toCode}`];
  if (observed != null) return observed;
  const a = PLATFORMS[fromCode];
  const b = PLATFORMS[toCode];
  if (!a || !b || a.line !== b.line) return NaN;
  return Math.abs(b.order - a.order) * LINES[a.line].minutesPerStop;
}

export function transferMinutes(fromCode: string, toCode: string): number {
  const station = stationForCode(fromCode);
  return station?.transferMin?.[`${fromCode}>${toCode}`] ?? DEFAULT_TRANSFER_MIN;
}

/** Whether a line runs at `now` (service end may pass midnight). */
export function inService(line: Pick<Line, "serviceStart" | "serviceEnd">, now: number): boolean {
  const tod = sgtMinuteOfDay(now);
  const { serviceStart: start, serviceEnd: end } = line;
  if (end <= MINUTES_PER_DAY) return tod >= start && tod <= end;
  return tod >= start || tod <= end - MINUTES_PER_DAY;
}

export function localName(value: { en: string; "zh-Hant": string }, locale: Locale) {
  return value[locale] || value.en;
}

export type DirectionChoice = {
  /** Platform code the reading is for, e.g. "TE17". */
  station: string;
  line: LineCode;
  color: string;
  direction: string;
  board: Direction["board"];
  /** Early-ending trains ("Springleaf") count as the same direction. */
  alsoBoard: Direction["board"][];
};

/** Every "which way" button for a station, as the platform boards name them. */
export function directionChoices(stationSlug: string): DirectionChoice[] {
  const station = getStation(stationSlug);
  if (!station) return [];
  return station.codes.flatMap((code) => {
    const line = LINES[PLATFORMS[code].line];
    return Object.values(line.directions)
      .filter((d) => d.terminal !== code)
      .map((d) => ({ station: code, line: line.code, color: line.color, direction: d.key, board: d.board, alsoBoard: d.alsoBoard ?? [] }));
  });
}

/** Station search over English, Chinese and platform codes. */
export function searchStations(query: string): Station[] {
  const q = query.trim().toLowerCase();
  if (!q) return STATIONS;
  return STATIONS.filter(
    (s) => s.name.en.toLowerCase().includes(q) || s.name["zh-Hant"].includes(query.trim()) || s.codes.some((c) => c.toLowerCase() === q) || s.slug.includes(q),
  );
}

/* ---------- Public routing: at most two transfers ---------- */

export type RouteRide = {
  kind: "ride";
  line: LineCode;
  from: string;
  to: string;
  direction: string;
  rideMin: number;
};
export type RouteTransfer = { kind: "transfer"; at: string; from: string; to: string; min: number };
export type RouteStep = RouteRide | RouteTransfer;
export type Route = { steps: RouteStep[]; transfers: number; totalMin: number };

function ride(from: string, to: string): RouteRide | null {
  const dir = directionBetween(from, to);
  if (!dir) return null;
  return {
    kind: "ride",
    line: PLATFORMS[from].line,
    from,
    to,
    direction: dir.key,
    rideMin: rideMinutes(from, to),
  };
}
function codeOn(station: Station, line: LineCode) {
  return station.codes.find((c) => PLATFORMS[c]?.line === line);
}

/** Every route between two stations with ≤ maxTransfers, fastest first. */
export function findRoutes(fromSlug: string, toSlug: string, maxTransfers = 2): Route[] {
  const origin = getStation(fromSlug);
  const dest = getStation(toSlug);
  if (!origin || !dest || origin.slug === dest.slug) return [];
  const routes: Route[] = [];
  const interchanges = STATIONS.filter((s) => s.codes.length > 1);

  const search = (at: Station, entryCode: string | null, used: LineCode[], steps: RouteStep[]) => {
    const transfers = used.length - 1;
    for (const code of at.codes) {
      const line = PLATFORMS[code].line;
      if (used.includes(line)) continue;
      const lead: RouteStep[] =
        entryCode && entryCode !== code
          ? [{ kind: "transfer", at: at.slug, from: entryCode, to: code, min: transferMinutes(entryCode, code) }]
          : [];
      const destCode = codeOn(dest, line);
      if (destCode) {
        const r = ride(code, destCode);
        if (r) {
          const all = [...steps, ...lead, r];
          routes.push({ steps: all, transfers: transfers + 1, totalMin: total(all) });
        }
      }
      // Riding on from here to another interchange adds a transfer.
      if (used.length >= maxTransfers) continue;
      for (const x of interchanges) {
        if (x.slug === at.slug || x.slug === origin.slug) continue;
        const xCode = codeOn(x, line);
        if (!xCode) continue;
        const r = ride(code, xCode);
        if (r) search(x, xCode, [...used, line], [...steps, ...lead, r]);
      }
    }
  };
  search(origin, null, [], []);
  const seen = new Set<string>();
  return routes
    .filter((r) => {
      const key = r.steps.map((s) => (s.kind === "ride" ? `${s.from}-${s.to}` : "x")).join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.totalMin - b.totalMin || a.transfers - b.transfers);
}
function total(steps: RouteStep[]) {
  return steps.reduce((sum, s) => sum + (s.kind === "ride" ? s.rideMin : s.min), 0);
}
