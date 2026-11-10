/**
 * Owner trip events (timestamp = the moment of the tap, or the time the
 * owner picked), accuracy capture, and the train sighting each board /
 * alight event implies (kept in step on edit and delete).
 */
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { predictionCheck, tripEvent } from "../db/schema";
import { TRIP_KINDS } from "../analytics/events";
import { scorePrediction } from "../predict/accuracy";
import { timeBand } from "../predict";
import { DIRECTION_KEY_RE, LINE_CODE_LIST, PLATFORM_CODE_RE, getPlatform } from "../network";
import { HOUR, MINUTE, sgtDate } from "../time";
import { platformPrediction } from "./board";
import { syncSightingForTripEvent, tapErrorFor } from "./sightings";

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
  /** "now" = tapped at Now (±0.5 min); "chosen" = moved back with the chips / picker (±1). Optional. */
  timeSource: z.enum(["now", "chosen"]).optional(),
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

/** Boardings logged more than this after they happened are not scored (the time was moved back). */
export const SCORE_MAX_LAG_MS = 2 * MINUTE;
/** A "Got off" belongs to the boarding before it within this long. */
const RIDE_LINK_MS = 3 * HOUR;

type Snapshot = Awaited<ReturnType<typeof platformPrediction>>;

/**
 * What we would have predicted for a boarding, taken BEFORE the boarding is
 * written (so it can't see itself). Only for boardings logged as they
 * happen (≤ 2 min late); back-dated ones aren't scored.
 */
async function snapshotPrediction(input: { kind: string; station?: string | null; direction?: string | null }, at: number, receivedAt: number): Promise<Snapshot> {
  if (input.kind !== "board" || !input.station || !input.direction) return null;
  if (receivedAt - at > SCORE_MAX_LAG_MS) return null;
  return platformPrediction(input.station, input.direction, at).catch(() => null);
}

async function storePredictionCheck(db: Db, row: Pick<EventRow, "id" | "station" | "direction" | "at">, prediction: Snapshot) {
  if (!prediction || !row.station || !row.direction) return;
  const platform = getPlatform(row.station);
  if (!platform) return;
  const at = new Date(row.at).getTime();
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

/**
 * "Got off" rides the train boarded before it: same line, the latest
 * boarding within 3 h with no getting off since → its direction.
 */
async function boardingDirection(db: Db, userId: string, station: string, at: number): Promise<string | null> {
  const line = getPlatform(station)?.line;
  if (!line) return null;
  const [last] = await db
    .select({ kind: tripEvent.kind, line: tripEvent.line, direction: tripEvent.direction })
    .from(tripEvent)
    .where(and(eq(tripEvent.userId, userId), lte(tripEvent.at, new Date(at)), gte(tripEvent.at, new Date(at - RIDE_LINK_MS))))
    .orderBy(desc(tripEvent.at), desc(tripEvent.id))
    .limit(10)
    .then((rows) => rows.filter((r) => r.kind === "board" || r.kind === "alight").slice(0, 1));
  return last?.kind === "board" && last.line === line && last.direction ? last.direction : null;
}

export async function logTripEvent(userId: string, input: TripEventInput, source = "owner", receivedAt = Date.now()) {
  const at = Date.parse(input.at);
  const db = getDb();
  const direction = (input.kind === "alight" && input.station ? await boardingDirection(db, userId, input.station, at).catch(() => null) : null) ?? input.direction ?? null;
  const snapshot = await snapshotPrediction({ kind: input.kind, station: input.station, direction }, at, receivedAt);
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
      direction,
      journeyKey: input.journeyKey ?? null,
      note: input.note ?? null,
      source,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return { id: null, sightingId: null };
  await storePredictionCheck(db, row, snapshot).catch(() => null);
  const sightingId = await syncSightingForTripEvent(db, row, { errorMin: tapErrorFor(input, at, receivedAt) }).catch(() => null);
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

/** Timeline edit: move the time and/or fix the platform; the linked sighting follows (marked edited, not scored). */
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
  // An edited boarding is no longer scored (we can't know what was shown at the new moment).
  await db.delete(predictionCheck).where(eq(predictionCheck.tripEventId, row.id));
  // A moved time was chosen by hand: ±1 min, and the sighting is marked edited.
  await syncSightingForTripEvent(db, row, { edited: true, ...(patch.at ? { errorMin: 1 } : {}) });
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
