import { sgtMinuteOfDay, MINUTES_PER_DAY } from "../time";
import {
  BRANCH_CHANGE_MIN,
  DEFAULT_TRANSFER_MIN,
  LINES,
  LINE_CODE_LIST,
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

export const LINE_CODES: LineCode[] = [...LINE_CODE_LIST];

export function isLineCode(value: unknown): value is LineCode {
  return typeof value === "string" && value in LINES;
}
export function getLine(code: string): Line | undefined {
  return isLineCode(code) ? LINES[code] : undefined;
}
export function getPlatform(code: string): Platform | undefined {
  return PLATFORMS[code];
}
const STATION_BY_SLUG = new Map(STATIONS.map((s) => [s.slug, s]));
export function getStation(slug: string): Station | undefined {
  return STATION_BY_SLUG.get(slug);
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
/** Platforms of a line in running order (first path that contains each). */
export function platformsOnLine(line: LineCode): Platform[] {
  return Object.values(PLATFORMS)
    .filter((p) => p.line === line)
    .sort((a, b) => a.order - b.order);
}

/* ---------- Paths, hop minutes and train offsets ---------- */

/** Does a train in this direction leave from `code` (on a path, not at its end)? */
export function directionServes(direction: Direction, code: string): boolean {
  return direction.paths.some((p) => {
    const i = p.indexOf(code);
    return i >= 0 && i < p.length - 1;
  });
}
/** Directions with trains leaving a platform (a terminal only has trains one way). */
export function directionsAt(code: string): Direction[] {
  const p = PLATFORMS[code];
  if (!p) return [];
  return Object.values(LINES[p.line].directions).filter((d) => directionServes(d, code));
}

const key = (a: string, b: string) => `${a}>${b}`;

/** Minutes between two adjacent platforms; built once from RIDE_MINUTES. */
const HOP = (() => {
  const hops = new Map<string, number>();
  const pathFor = (a: string, b: string) => {
    for (const line of Object.values(LINES))
      for (const d of Object.values(line.directions))
        for (const p of d.paths) {
          const i = p.indexOf(a);
          const j = p.indexOf(b);
          if (i >= 0 && j > i) return p.slice(i, j + 1);
        }
    return null;
  };
  const set = (a: string, b: string, v: number) => {
    hops.set(key(a, b), v);
    if (!hops.has(key(b, a))) hops.set(key(b, a), v);
  };
  const observed = Object.entries(RIDE_MINUTES)
    .map(([k, v]) => {
      const [a, b] = k.split(">");
      return { a, b, v, path: pathFor(a, b) };
    })
    .filter((o): o is { a: string; b: string; v: number; path: string[] } => o.path != null)
    .sort((x, y) => x.path.length - y.path.length);
  for (const o of observed) {
    const pairs = o.path.slice(1).map((c, i) => [o.path[i], c] as const);
    if (pairs.length === 1) {
      hops.set(key(o.a, o.b), o.v);
      if (!hops.has(key(o.b, o.a))) hops.set(key(o.b, o.a), o.v);
      continue;
    }
    const unknown = pairs.filter(([a, b]) => !hops.has(key(a, b)));
    if (!unknown.length) continue;
    const known = pairs.filter(([a, b]) => hops.has(key(a, b))).reduce((s, [a, b]) => s + hops.get(key(a, b))!, 0);
    const each = Math.max(0.5, (o.v - known) / unknown.length);
    for (const [a, b] of unknown) set(a, b, each);
  }
  return hops;
})();

export function hopMinutes(a: string, b: string): number {
  const v = HOP.get(key(a, b));
  if (v != null) return v;
  const p = PLATFORMS[a];
  return p ? LINES[p.line].minutesPerStop : 2;
}

type IndexedPath = { codes: string[]; pos: Map<string, number>; cum: number[] };
const PATHS = new Map<string, IndexedPath[]>();
function indexedPaths(line: string, direction: string): IndexedPath[] {
  const k = `${line}:${direction}`;
  const cached = PATHS.get(k);
  if (cached) return cached;
  const d = getDirection(line, direction);
  const out = (d?.paths ?? []).map((codes) => {
    const cum = [0];
    for (let i = 1; i < codes.length; i++) cum.push(cum[i - 1] + hopMinutes(codes[i - 1], codes[i]));
    return { codes, pos: new Map(codes.map((c, i) => [c, i])), cum };
  });
  PATHS.set(k, out);
  return out;
}

export type TrainOffset = { minutes: number; hops: number };

/**
 * Where the same train is at `to` relative to `from` (direction `direction`):
 * positive minutes downstream (later), negative upstream (earlier). Upstream
 * of a junction where branches merge is ambiguous, so it is only given when
 * every path through `from` agrees. `stopAt` cuts the trip short at an early
 * terminal (e.g. Springleaf) when the board said so.
 */
export function trainOffset(line: string, direction: string, from: string, to: string, stopAt?: string | null): TrainOffset | null {
  if (from === to) return { minutes: 0, hops: 0 };
  const paths = indexedPaths(line, direction).filter((p) => p.pos.has(from));
  if (!paths.length) return null;
  // Every path through `from` must agree (branches that merge or split make it ambiguous).
  const offsets = paths.map((p) => {
    const i = p.pos.get(from)!;
    const j = p.pos.get(to);
    if (j == null) return null;
    if (stopAt && j > i) {
      const s = p.pos.get(stopAt);
      if (s != null && s > i && j > s) return null;
    }
    return { minutes: p.cum[j] - p.cum[i], hops: j - i };
  });
  const first = offsets[0];
  if (!first || offsets.some((o) => o == null || Math.sign(o.hops) !== Math.sign(first.hops) || Math.abs(o.minutes - first.minutes) > 0.5)) return null;
  return first;
}

/** Which direction a train must run to go from one platform to another. */
export function directionBetween(fromCode: string, toCode: string): Direction | undefined {
  const a = PLATFORMS[fromCode];
  const b = PLATFORMS[toCode];
  if (!a || !b || a.line !== b.line || fromCode === toCode) return undefined;
  return Object.values(LINES[a.line].directions).find((d) =>
    d.paths.some((p) => {
      const i = p.indexOf(fromCode);
      const j = p.indexOf(toCode);
      return i >= 0 && j > i;
    }),
  );
}

/** In-vehicle minutes: an observed figure if known, else the sum of hops (to the half minute). */
export function rideMinutes(fromCode: string, toCode: string): number {
  const observed = RIDE_MINUTES[key(fromCode, toCode)];
  if (observed != null) return observed;
  const dir = directionBetween(fromCode, toCode);
  if (!dir) return NaN;
  // The shortest path that rides from → to (a split line may offer two).
  const options = indexedPaths(PLATFORMS[fromCode].line, dir.key)
    .map((p) => {
      const i = p.pos.get(fromCode);
      const j = p.pos.get(toCode);
      return i != null && j != null && j > i ? p.cum[j] - p.cum[i] : Infinity;
    })
    .filter(Number.isFinite);
  return options.length ? Math.round(Math.min(...options) * 2) / 2 : NaN;
}

export function transferMinutes(fromCode: string, toCode: string): number {
  if (fromCode === toCode) return BRANCH_CHANGE_MIN;
  const station = stationForCode(fromCode);
  return station?.transferMin?.[key(fromCode, toCode)] ?? DEFAULT_TRANSFER_MIN;
}
/** Whether a transfer figure was observed rather than estimated. */
export function transferObserved(fromCode: string, toCode: string): boolean {
  return Boolean(stationForCode(fromCode)?.transferObserved?.includes(key(fromCode, toCode)));
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
    return directionsAt(code).map((d) => ({
      station: code,
      line: line.code,
      color: line.color,
      direction: d.key,
      board: d.board,
      alsoBoard: (d.alsoBoard ?? []).map((b) => ({ en: b.en, "zh-Hant": b["zh-Hant"] })),
    }));
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

/* ---------- Nearest station (computed on the device; never stored or sent) ---------- */

/** Great-circle distance in metres. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function stationsByDistance(lat: number, lng: number): { station: Station; distanceM: number }[] {
  return STATIONS.map((station) => ({ station, distanceM: distanceM(lat, lng, station.lat, station.lng) })).sort((a, b) => a.distanceM - b.distanceM);
}
/** Nearest station within `maxM` metres (default 1.5 km), else null. */
export function nearestStation(lat: number, lng: number, maxM = 1500): { station: Station; distanceM: number } | null {
  const best = stationsByDistance(lat, lng)[0];
  return best && best.distanceM <= maxM ? best : null;
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

/** Rideable corridors: each distinct path (either way) of every line. */
type Corridor = { id: string; line: LineCode; codes: string[] };
const CORRIDORS: Corridor[] = (() => {
  const out: Corridor[] = [];
  const seen = new Set<string>();
  for (const line of Object.values(LINES))
    for (const d of Object.values(line.directions))
      for (const p of d.paths) {
        const k = [...p].sort().join(",");
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ id: `${line.code}:${out.filter((c) => c.line === line.code).length}`, line: line.code, codes: p });
      }
  return out;
})();
const CORRIDORS_AT = new Map<string, Corridor[]>();
for (const c of CORRIDORS) for (const code of c.codes) CORRIDORS_AT.set(code, [...(CORRIDORS_AT.get(code) ?? []), c]);

/** Places to change: stations with several codes, and branch junctions. */
const CHANGE_POINTS: { slug: string; code: string; corridor: Corridor }[] = STATIONS.flatMap((s) =>
  s.codes.flatMap((code) => (CORRIDORS_AT.get(code) ?? []).map((corridor) => ({ slug: s.slug, code, corridor }))),
).filter((x) => {
  const st = getStation(x.slug)!;
  return st.codes.length > 1 || (CORRIDORS_AT.get(x.code)?.length ?? 0) > 1;
});

function ride(from: string, to: string): RouteRide | null {
  const dir = directionBetween(from, to);
  if (!dir) return null;
  return { kind: "ride", line: PLATFORMS[from].line, from, to, direction: dir.key, rideMin: rideMinutes(from, to) };
}

/** Every route between two stations with ≤ maxTransfers, fastest first. */
export function findRoutes(fromSlug: string, toSlug: string, maxTransfers = 2): Route[] {
  const origin = getStation(fromSlug);
  const dest = getStation(toSlug);
  if (!origin || !dest || origin.slug === dest.slug) return [];
  const routes: Route[] = [];

  const search = (atSlug: string, entryCode: string | null, used: string[], visited: string[], steps: RouteStep[]) => {
    const at = getStation(atSlug)!;
    for (const code of at.codes) {
      for (const corridor of CORRIDORS_AT.get(code) ?? []) {
        if (used.includes(corridor.id)) continue;
        const lead: RouteStep[] = entryCode ? [{ kind: "transfer", at: at.slug, from: entryCode, to: code, min: transferMinutes(entryCode, code) }] : [];
        const destCode = dest.codes.find((c) => corridor.codes.includes(c));
        if (destCode) {
          const r = ride(code, destCode);
          if (r && Number.isFinite(r.rideMin)) {
            const all = [...steps, ...lead, r];
            routes.push({ steps: all, transfers: used.length, totalMin: total(all) });
          }
        }
        if (used.length >= maxTransfers) continue;
        for (const x of CHANGE_POINTS) {
          if (x.corridor.id !== corridor.id || x.slug === at.slug || visited.includes(x.slug) || x.slug === dest.slug) continue;
          const r = ride(code, x.code);
          if (r && Number.isFinite(r.rideMin)) search(x.slug, x.code, [...used, corridor.id], [...visited, x.slug], [...steps, ...lead, r]);
        }
      }
    }
  };
  search(origin.slug, null, [], [origin.slug], []);
  const seen = new Set<string>();
  return routes
    .filter((r) => {
      const k = r.steps.map((s) => (s.kind === "ride" ? `${s.from}-${s.to}` : "x")).join("|");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.totalMin - b.totalMin || a.transfers - b.transfers);
}
function total(steps: RouteStep[]) {
  return steps.reduce((sum, s) => sum + (s.kind === "ride" ? s.rideMin : s.min), 0);
}
