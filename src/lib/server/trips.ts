/**
 * Owner trip events (timestamp = the moment of the tap, or the time the
 * owner picked), accuracy capture, and the train sighting each board /
 * alight event implies (kept in step on edit and delete).
 */
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { predictionCheck, tripEvent } from "../db/schema";
import { TRIP_KINDS } from "../analytics/events";
import { scorePrediction } from "../predict/accuracy";
import { timeBand } from "../predict";
import { DIRECTION_KEY_RE, LINE_CODE_LIST, PLATFORM_CODE_RE, getPlatform } from "../network";
import { sgtDate } from "../time";
import { platformPrediction } from "./board";
import { syncSightingForTripEvent } from "./sightings";

export const UNDO_WINDOW_MS = 10_000;

export const tripEventInput = z.strictObject({
  clientId: z.uuid(),
  kind: z.enum(TRIP_KINDS),
  at: z.string().datetime({ offset: true }),
  station: z.string().regex(PLATFORM_CODE_RE).optional(),
  line: z.enum(LINE_CODE_LIST).optional(),
  direction: z.string().regex(DIRECTION_KEY_RE).optional(),
  journeyKey: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  note: z.string().max(500).optional(),
});
export type TripEventInput = z.infer<typeof tripEventInput>;

/** Timeline edit: a new time and/or a corrected platform + direction. */
export const tripEventPatch = z.strictObject({
  id: z.number().int().positive(),
  at: z.string().datetime({ offset: true }).optional(),
  station: z.string().regex(PLATFORM_CODE_RE).nullable().optional(),
  direction: z.string().regex(DIRECTION_KEY_RE).nullable().optional(),
});
export type TripEventPatch = z.infer<typeof tripEventPatch>;

type Db = ReturnType<typeof getDb>;
type EventRow = typeof tripEvent.$inferSelect;

/** Store what we would have predicted when the owner boarded (before the boarding itself counts). */
async function recordPredictionCheck(db: Db, row: Pick<EventRow, "id" | "kind" | "station" | "direction" | "at">) {
  if (row.kind !== "board" || !row.station || !row.direction) return;
  const platform = getPlatform(row.station);
  const at = new Date(row.at).getTime();
  const prediction = await platformPrediction(row.station, row.direction, at, { excludeTripEventId: row.id }).catch(() => null);
  if (!prediction || !platform) return;
  const check = scorePrediction(prediction, at);
  await db.insert(predictionCheck).values({
    tripEventId: row.id,
    line: platform.line,
    station: row.station,
    direction: row.direction,
    band: timeBand(at),
    boardedAt: new Date(at),
    predictedAt: check.predictedAt ? new Date(check.predictedAt) : null,
    kind: prediction.kind,
    basis: prediction.basis,
    confidence: prediction.confidence,
    errorMin: check.errorMin,
    hit: check.hit,
  });
}

export async function logTripEvent(userId: string, input: TripEventInput, source = "owner") {
  const at = Date.parse(input.at);
  const db = getDb();
  const [row] = await db
    .insert(tripEvent)
    .values({
      userId,
      clientId: input.clientId,
      kind: input.kind,
      at: new Date(at),
      tripDate: sgtDate(at),
      station: input.station ?? null,
      line: input.line ?? (input.station ? getPlatform(input.station)?.line : null) ?? null,
      direction: input.direction ?? null,
      journeyKey: input.journeyKey ?? null,
      note: input.note ?? null,
      source,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return { id: null, sightingId: null };
  await recordPredictionCheck(db, row).catch(() => null);
  const sightingId = await syncSightingForTripEvent(db, row).catch(() => null);
  return { id: row.id, sightingId };
}

export type TimelineEvent = {
  id: number;
  clientId: string;
  kind: string;
  at: number;
  station: string | null;
  line: string | null;
  direction: string | null;
  journeyKey: string | null;
};

/** Today's (SGT) taps for one owner, oldest first. */
export async function todaysEvents(userId: string, now = Date.now()): Promise<TimelineEvent[]> {
  const rows = await getDb()
    .select({
      id: tripEvent.id,
      clientId: tripEvent.clientId,
      kind: tripEvent.kind,
      station: tripEvent.station,
      line: tripEvent.line,
      direction: tripEvent.direction,
      at: tripEvent.at,
      journeyKey: tripEvent.journeyKey,
    })
    .from(tripEvent)
    .where(and(eq(tripEvent.userId, userId), eq(tripEvent.tripDate, sgtDate(now))))
    .orderBy(tripEvent.at)
    .limit(200);
  return rows.map((r) => ({ ...r, at: new Date(r.at).getTime() }));
}

/** Timeline edit: move the time and/or fix the platform; the linked sighting follows. */
export async function updateTripEvent(userId: string, patch: TripEventPatch) {
  const db = getDb();
  const current = await db.query.tripEvent.findFirst({ where: and(eq(tripEvent.id, patch.id), eq(tripEvent.userId, userId)) });
  if (!current) return { ok: false as const };
  const set: Partial<typeof tripEvent.$inferInsert> = {};
  if (patch.at) {
    const at = Date.parse(patch.at);
    set.at = new Date(at);
    set.tripDate = sgtDate(at);
  }
  if (patch.station !== undefined) {
    set.station = patch.station;
    set.line = patch.station ? (getPlatform(patch.station)?.line ?? null) : null;
  }
  if (patch.direction !== undefined) set.direction = patch.direction;
  const [row] = await db.update(tripEvent).set(set).where(eq(tripEvent.id, current.id)).returning();
  if (!row) return { ok: false as const };
  // The accuracy check was for the old moment: redo it.
  await db.delete(predictionCheck).where(eq(predictionCheck.tripEventId, row.id));
  await recordPredictionCheck(db, row).catch(() => null);
  await syncSightingForTripEvent(db, row);
  return { ok: true as const, id: row.id };
}

/** Timeline delete (any time); the linked sighting and accuracy check go with it. */
export async function deleteTripEvent(userId: string, id: number) {
  const deleted = await getDb()
    .delete(tripEvent)
    .where(and(eq(tripEvent.id, id), eq(tripEvent.userId, userId)))
    .returning({ id: tripEvent.id });
  return { deleted: deleted.length > 0 };
}

/** Undo: only the owner's own event, only within 10 s of logging it. */
export async function undoTripEvent(userId: string, clientId: string, now = Date.now()) {
  const deleted = await getDb()
    .delete(tripEvent)
    .where(
      and(
        eq(tripEvent.userId, userId),
        eq(tripEvent.clientId, clientId),
        gte(tripEvent.createdAt, new Date(now - UNDO_WINDOW_MS - 5_000)),
      ),
    )
    .returning({ id: tripEvent.id });
  return { undone: deleted.length > 0 };
}
