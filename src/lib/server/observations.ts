/**
 * Observation queries. Request paths never read whole tables: every read
 * is keyed by platform/station codes or line+direction, bounded in time.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, dbConfigured, type Db } from "../db";
import { appSetting, observation } from "../db/schema";
import { DEFAULT_UNSTABLE_WINDOWS, type Observation, type UnstableWindow } from "../predict";
import { DAY } from "../time";

export const HISTORY_DAYS = 120;

type Row = typeof observation.$inferSelect;
export function toObservation(r: Row): Observation {
  return {
    id: r.id,
    station: r.station,
    line: r.line,
    direction: r.direction,
    destination: r.destination,
    capturedAt: new Date(r.capturedAt).getTime(),
    minutes: r.minutes,
    source: r.source as Observation["source"],
    status: r.status as Observation["status"],
  };
}

export function observationStore(db: Pick<Db, "select">) {
  return {
    /** Approved readings at the given platforms (codes), recent history. */
    async forPlatforms(codes: string[], now: number): Promise<Observation[]> {
      if (!codes.length) return [];
      const rows = await db
        .select()
        .from(observation)
        .where(
          and(
            inArray(observation.station, codes),
            eq(observation.status, "approved"),
            gte(observation.capturedAt, new Date(now - HISTORY_DAYS * DAY)),
          ),
        )
        .orderBy(desc(observation.capturedAt))
        .limit(2000);
      return rows.map(toObservation);
    },
    /** Approved readings on lines (for band headways), recent history. */
    async forLines(lines: string[], now: number): Promise<Observation[]> {
      if (!lines.length) return [];
      const rows = await db
        .select()
        .from(observation)
        .where(
          and(
            inArray(observation.line, lines),
            eq(observation.status, "approved"),
            gte(observation.capturedAt, new Date(now - HISTORY_DAYS * DAY)),
          ),
        )
        .orderBy(desc(observation.capturedAt))
        .limit(3000);
      return rows.map(toObservation);
    },
    /** Approved readings at one platform within ±window of an instant (moderation). */
    async near(station: string, line: string, direction: string, at: number, windowMs: number): Promise<Observation[]> {
      const rows = await db
        .select()
        .from(observation)
        .where(
          and(
            eq(observation.station, station),
            eq(observation.line, line),
            eq(observation.direction, direction),
            eq(observation.status, "approved"),
            gte(observation.capturedAt, new Date(at - windowMs)),
            sql`${observation.capturedAt} <= ${new Date(at + windowMs).toISOString()}::timestamptz`,
          ),
        )
        .limit(50);
      return rows.map(toObservation);
    },
  };
}

/** Readings for prediction at the given platforms, merged with line-wide history. */
export async function loadObservations(codes: string[], lines: string[], now: number): Promise<Observation[]> {
  if (!dbConfigured()) return [];
  const store = observationStore(getDb());
  const [platform, line] = await Promise.all([store.forPlatforms(codes, now), store.forLines(lines, now)]);
  const seen = new Set<number>();
  return [...platform, ...line].filter((o) => (o.id == null || seen.has(o.id) ? false : (seen.add(o.id), true)));
}

export type PredictorEngine = "v1" | "v2";
export type WindowSettings = {
  windows: UnstableWindow[];
  /** Edited in admin (then they win over learning). */
  custom: boolean;
  /** Admin kill switch: "v1" = the v1.2 predictor everywhere (app_setting predictor_engine). */
  engine: PredictorEngine;
};
export const ENGINE_SETTING_KEY = "predictor_engine";
let windowsCache: { at: number; value: WindowSettings } | null = null;
/** Unstable windows (the admin's list when saved, else the default) and the predictor engine. */
export async function getWindowSettings(now = Date.now()): Promise<WindowSettings> {
  const fallback: WindowSettings = { windows: DEFAULT_UNSTABLE_WINDOWS, custom: false, engine: "v2" };
  if (!dbConfigured()) return fallback;
  if (windowsCache && now - windowsCache.at < 60_000) return windowsCache.value;
  try {
    const rows = await getDb()
      .select()
      .from(appSetting)
      .where(inArray(appSetting.key, ["unstable_windows", ENGINE_SETTING_KEY]));
    const windows = rows.find((r) => r.key === "unstable_windows")?.value;
    const engine = (rows.find((r) => r.key === ENGINE_SETTING_KEY)?.value as { engine?: string } | undefined)?.engine;
    const value: WindowSettings = {
      ...(Array.isArray(windows) ? { windows: windows as UnstableWindow[], custom: true } : { windows: DEFAULT_UNSTABLE_WINDOWS, custom: false }),
      engine: engine === "v1" ? "v1" : "v2",
    };
    windowsCache = { at: now, value };
    return value;
  } catch {
    return fallback;
  }
}
export async function getUnstableWindows(now = Date.now()): Promise<UnstableWindow[]> {
  return (await getWindowSettings(now)).windows;
}
export function clearWindowsCache() {
  windowsCache = null;
}
