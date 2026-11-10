/**
 * Ride minutes learned from the owner's trips (board → got off pairs).
 * Keyed by line like every request-path read, bounded in time, cached 10 min.
 */
import { and, gte, inArray, isNotNull } from "drizzle-orm";
import { dbConfigured, getDb } from "../db";
import { tripEvent } from "../db/schema";
import type { RideOverrides } from "../network";
import { learnRideTimes } from "../predict/rides";
import { DAY, MINUTE } from "../time";

const TTL_MS = 10 * MINUTE;
const WINDOW_DAYS = 120;
const cache = new Map<string, { at: number; value: RideOverrides }>();

export async function learnedRides(lines: string[], now = Date.now()): Promise<RideOverrides> {
  if (!dbConfigured() || !lines.length) return {};
  const key = [...new Set(lines)].sort().join(",");
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  try {
    const rows = await getDb()
      .select({ userId: tripEvent.userId, kind: tripEvent.kind, at: tripEvent.at, station: tripEvent.station, line: tripEvent.line, direction: tripEvent.direction })
      .from(tripEvent)
      .where(
        and(
          inArray(tripEvent.line, key.split(",")),
          inArray(tripEvent.kind, ["board", "alight"]),
          isNotNull(tripEvent.station),
          gte(tripEvent.at, new Date(now - WINDOW_DAYS * DAY)),
        ),
      )
      .limit(5000);
    const value = learnRideTimes(rows.map((r) => ({ ...r, at: new Date(r.at).getTime() })));
    cache.set(key, { at: now, value });
    return value;
  } catch {
    return hit?.value ?? {};
  }
}

export function clearRidesCache() {
  cache.clear();
}
