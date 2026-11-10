import { sgtMinuteOfDay, MINUTES_PER_DAY } from "../time";
import {
  BRANCH_CHANGE_MIN,
  DEFAULT_TRANSFER_MIN,
  LEGACY_DIRECTIONS,
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
/** A direction new rows may use (retired keys are refused; stored ones are read via `canonicalDirection`). */
export function isValidDirection(line: string, key: string) {
  const d = getDirection(line, key);
  return Boolean(d && !d.retired);
}
/** The current direction for a stored row (see LEGACY_DIRECTIONS); unchanged otherwise. */
export function canonicalDirection(line: string, key: string, station?: string | null): string {
  const hit = LEGACY_DIRECTIONS.find((l) => l.line === line && l.key === key && (!l.stations || (station != null && l.stations.includes(station))));
  return hit?.into ?? key;
}
/** Live directions of a line (retired keys left out). */
function liveDirections(line: Line): Direction[] {
  return Object.values(line.directions).filter((d) => !d.retired);
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
  if (direction.retired) return false;
  if (direction.loop?.includes(code)) return true;
  return direction.paths.some((p) => {
    const i = p.indexOf(code);
    return i >= 0 && i < p.length - 1;
  });
}
/** Directions with trains leaving a platform (a terminal only has trains one way). */
export function directionsAt(code: string): Direction[] {
  const p = PLATFORMS[code];
  if (!p) return [];
  return liveDirections(LINES[p.line]).filter((d) => directionServes(d, code));
}

/**
 * Stops from `a` forward to `b` round a loop (both ends included), or null.
 * Never the whole way round (a ≠ b).
 */
function loopSlice(loop: readonly string[], a: string, b: string): string[] | null {
  const i = loop.indexOf(a);
  const j = loop.indexOf(b);
  if (i < 0 || j < 0 || i === j) return null;
  return j > i ? loop.slice(i, j + 1) : [...loop.slice(i), ...loop.slice(0, j + 1)];
}

const key = (a: string, b: string) => `${a}>${b}`;

/**
 * Ride minutes learned from the owner's own trips ("A>B" → median minutes,
 * ≥ 3 board → got-off pairs). They win over the hand-entered figures and
 * the 2-min default. See learnRideTimes in predict/rides.ts.
 */
export type RideOverrides = Readonly<Record<string, number>>;

/** The shortest run of stops from a to b on any live path or loop. */
function pathBetween(a: string, b: string): string[] | null {
  const runs: string[][] = [];
  for (const line of Object.values(LINES))
    for (const d of liveDirections(line)) {
      for (const p of d.paths) {
        const i = p.indexOf(a);
        const j = p.indexOf(b);
        if (i >= 0 && j > i) runs.push(p.slice(i, j + 1));
      }
      const round = d.loop ? loopSlice(d.loop, a, b) : null;
      if (round) runs.push(round);
    }
  return runs.reduce<string[] | null>((best, r) => (!best || r.length < best.length ? r : best), null);
}

/** Minutes between adjacent platforms from ride figures; longer rides spread over their unknown hops. */
function buildHops(rides: Readonly<Record<string, number>>): Map<string, number> {
  const hops = new Map<string, number>();
  const set = (a: string, b: string, v: number) => {
    hops.set(key(a, b), v);
    if (!hops.has(key(b, a))) hops.set(key(b, a), v);
  };
  const observed = Object.entries(rides)
    .map(([k, v]) => {
      const [a, b] = k.split(">");
      return { a, b, v, path: pathBetween(a, b) };
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
}
const BASE_HOPS = buildHops(RIDE_MINUTES);
const LEARNED_HOPS = new WeakMap<RideOverrides, Map<string, number>>();
function hopsFor(learned?: RideOverrides | null): Map<string, number> {
  if (!learned || !Object.keys(learned).length) return BASE_HOPS;
  let hops = LEARNED_HOPS.get(learned);
  // Learned figures first (they win), then the hand-entered ones fill the rest.
  if (!hops) LEARNED_HOPS.set(learned, (hops = buildHops({ ...learned, ...Object.fromEntries(Object.entries(RIDE_MINUTES).filter(([k]) => !(k in learned))) })));
  return hops;
}

export function hopMinutes(a: string, b: string, learned?: RideOverrides | null): number {
  const v = hopsFor(learned).get(key(a, b));
  if (v != null) return v;
  const p = PLATFORMS[a];
  return p ? LINES[p.line].minutesPerStop : 2;
}

/** A ride between two platforms was measured (observed or learned), not a per-stop default. */
export function rideMeasured(a: string, b: string, learned?: RideOverrides | null): boolean {
  return key(a, b) in RIDE_MINUTES || key(b, a) in RIDE_MINUTES || Boolean(learned && (key(a, b) in learned || key(b, a) in learned));
}

/** `loopTotal`: minutes once round (loops only: the last stop runs on to the first). */
type IndexedPath = { codes: string[]; pos: Map<string, number>; cum: number[]; loopTotal?: number };
const PATHS = new WeakMap<Map<string, number>, Map<string, IndexedPath[]>>();
function indexedPaths(line: string, direction: string, learned?: RideOverrides | null): IndexedPath[] {
  const hops = hopsFor(learned);
  let byDir = PATHS.get(hops);
  if (!byDir) PATHS.set(hops, (byDir = new Map()));
  const k = `${line}:${direction}`;
  const cached = byDir.get(k);
  if (cached) return cached;
  const d = getDirection(line, direction);
  const index = (codes: string[]): IndexedPath => {
    const cum = [0];
    for (let i = 1; i < codes.length; i++) cum.push(cum[i - 1] + hopMinutes(codes[i - 1], codes[i], learned));
    return { codes, pos: new Map(codes.map((c, i) => [c, i])), cum };
  };
  const out = (d?.paths ?? []).map(index);
  if (d?.loop) {
    const loop = index(d.loop);
    loop.loopTotal = loop.cum[loop.cum.length - 1] + hopMinutes(d.loop[d.loop.length - 1], d.loop[0], learned);
    out.push(loop);
  }
  byDir.set(k, out);
  return out;
}

/** Forward run from i to j (wrapping round a loop): hops, minutes and the stops passed. */
function forward(p: IndexedPath, i: number, j: number) {
  if (j >= i) return { hops: j - i, minutes: p.cum[j] - p.cum[i], between: p.codes.slice(i, j + 1) };
  if (p.loopTotal == null) return null;
  return { hops: p.codes.length - i + j, minutes: p.loopTotal - p.cum[i] + p.cum[j], between: [...p.codes.slice(i), ...p.codes.slice(0, j + 1)] };
}

export type TrainOffset = {
  minutes: number;
  hops: number;
  /** The stops from the earlier to the later platform, in running order (for per-hop error). */
  between: string[];
};

/** A path of this direction starts here: trains wait (dwell) at a terminal, so a boarding there doesn't time the train. */
export function isOriginTerminal(line: string, direction: string, code: string): boolean {
  const d = getDirection(line, direction);
  // Loop trains run straight through every stop.
  if (d?.loop?.includes(code)) return false;
  const paths = d?.paths.filter((p) => p.includes(code)) ?? [];
  return paths.length > 0 && paths.every((p) => p[0] === code);
}

/**
 * Where the same train is at `to` relative to `from` (direction `direction`):
 * positive minutes downstream (later), negative upstream (earlier). Upstream
 * of a junction where branches merge is ambiguous, so it is only given when
 * every path through `from` agrees. `stopAt` cuts the trip short at an early
 * terminal (e.g. Springleaf, or a possible short-turn) for stops beyond it.
 * `learned` ride minutes (owner's trips) win over the defaults. On a loop
 * the same train is both ahead and behind: the nearer way round is used
 * (downstream up to half the loop, else upstream).
 */
export function trainOffset(
  line: string,
  direction: string,
  from: string,
  to: string,
  stopAt?: string | null,
  learned?: RideOverrides | null,
): TrainOffset | null {
  if (from === to) return { minutes: 0, hops: 0, between: [from] };
  const paths = indexedPaths(line, direction, learned).filter((p) => p.pos.has(from));
  if (!paths.length) return null;
  // Every path through `from` must agree (branches that merge or split make it ambiguous).
  const offsets = paths.map((p): TrainOffset | null => {
    const i = p.pos.get(from)!;
    const j = p.pos.get(to);
    if (j == null) return null;
    if (p.loopTotal != null) {
      const ahead = forward(p, i, j)!;
      if (ahead.hops <= p.codes.length / 2) {
        // An early terminal on the way cuts the trip short.
        if (stopAt && ahead.between.slice(1, -1).includes(stopAt)) return null;
        return ahead;
      }
      const behind = forward(p, j, i)!;
      return { minutes: -behind.minutes, hops: -behind.hops, between: behind.between };
    }
    if (stopAt && j > i) {
      const s = p.pos.get(stopAt);
      if (s != null && s > i && j > s) return null;
    }
    return { minutes: p.cum[j] - p.cum[i], hops: j - i, between: p.codes.slice(Math.min(i, j), Math.max(i, j) + 1) };
  });
  const first = offsets[0];
  if (!first || offsets.some((o) => o == null || Math.sign(o.hops) !== Math.sign(first.hops) || Math.abs(o.minutes - first.minutes) > 0.5)) return null;
  return first;
}

/** Shortest in-vehicle minutes riding this direction from → to (Infinity when it doesn't). */
function rideWithin(line: string, direction: string, fromCode: string, toCode: string): number {
  let best = Infinity;
  for (const p of indexedPaths(line, direction, null)) {
    const i = p.pos.get(fromCode);
    const j = p.pos.get(toCode);
    if (i == null || j == null || i === j) continue;
    if (p.loopTotal == null && j < i) continue;
    best = Math.min(best, forward(p, i, j)!.minutes);
  }
  return best;
}

/**
 * Which direction a train must run to go from one platform to another. On
 * a loop both ways get there: the quicker one.
 */
export function directionBetween(fromCode: string, toCode: string): Direction | undefined {
  const a = PLATFORMS[fromCode];
  const b = PLATFORMS[toCode];
  if (!a || !b || a.line !== b.line || fromCode === toCode) return undefined;
  let best: { d: Direction; min: number } | undefined;
  for (const d of liveDirections(LINES[a.line])) {
    const min = rideWithin(a.line, d.key, fromCode, toCode);
    if (Number.isFinite(min) && (!best || min < best.min)) best = { d, min };
  }
  return best?.d;
}

/** In-vehicle minutes: an observed figure if known, else the sum of hops (to the half minute). */
export function rideMinutes(fromCode: string, toCode: string): number {
  const observed = RIDE_MINUTES[key(fromCode, toCode)];
  if (observed != null) return observed;
  const dir = directionBetween(fromCode, toCode);
  if (!dir) return NaN;
  // The shortest path that rides from → to (a split line or a loop may offer two).
  const min = rideWithin(PLATFORMS[fromCode].line, dir.key, fromCode, toCode);
  return Number.isFinite(min) ? Math.round(min * 2) / 2 : NaN;
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
    for (const d of liveDirections(line))
      for (const p of [...d.paths, ...(d.loop ? [d.loop] : [])]) {
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
