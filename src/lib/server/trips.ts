/** Owner trip events (timestamp = the moment of the tap) and accuracy capture. */
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { predictionCheck, tripEvent } from "../db/schema";
import { TRIP_KINDS } from "../analytics/events";
import { scorePrediction } from "../predict/accuracy";
import { timeBand } from "../predict";
import { getPlatform } from "../network";
import { sgtDate } from "../time";
import { platformPrediction } from "./board";

export const UNDO_WINDOW_MS = 10_000;

export const tripEventInput = z.strictObject({
  clientId: z.uuid(),
  kind: z.enum(TRIP_KINDS),
  at: z.string().datetime({ offset: true }),
  station: z.string().regex(/^[A-Z]{2}\d{1,2}$/).optional(),
  line: z.enum(["EWL", "TEL", "NEL"]).optional(),
  direction: z.string().regex(/^TO_[A-Z]{2,20}$/).optional(),
  journeyKey: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  note: z.string().max(500).optional(),
});
export type TripEventInput = z.infer<typeof tripEventInput>;

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
    .returning({ id: tripEvent.id });
  // Boarding at a platform: store what we would have predicted at that moment.
  if (row && input.kind === "board" && input.station && input.direction) {
    const prediction = await platformPrediction(input.station, input.direction, at).catch(() => null);
    const platform = getPlatform(input.station);
    if (prediction && platform) {
      const check = scorePrediction(prediction, at);
      await db.insert(predictionCheck).values({
        tripEventId: row.id,
        line: platform.line,
        station: input.station,
        direction: input.direction,
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
  }
  return { id: row?.id ?? null };
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
