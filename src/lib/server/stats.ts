/** The owner's own trip taps for /me/stats. */
import { and, asc, eq, gte } from "drizzle-orm";
import { dbConfigured, getDb } from "../db";
import { tripEvent } from "../db/schema";
import type { StatEvent } from "../stats/commute";
import { DAY, nowMs } from "../time";

const MAX_ROWS = 5000;

export async function ownerTripEvents(userId: string, days = 180): Promise<StatEvent[]> {
  if (!dbConfigured()) return [];
  const since = new Date(nowMs() - days * DAY);
  const rows = await getDb()
    .select({
      kind: tripEvent.kind,
      at: tripEvent.at,
      station: tripEvent.station,
      line: tripEvent.line,
      direction: tripEvent.direction,
      journeyKey: tripEvent.journeyKey,
    })
    .from(tripEvent)
    .where(and(eq(tripEvent.userId, userId), gte(tripEvent.at, since)))
    .orderBy(asc(tripEvent.at))
    .limit(MAX_ROWS);
  return rows.map((r) => ({ ...r, at: new Date(r.at).getTime() }));
}
