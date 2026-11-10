/**
 * Train sightings (boarded / got off). Reads are keyed by line + direction
 * and bounded in time, like observations. Owner and Hermes sightings come
 * from trip events (one sighting per board/alight event, linked by id);
 * public ones come from POST /api/sightings.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { dbConfigured, getDb, type Db } from "../db";
import { trainSighting, tripEvent } from "../db/schema";
import { DIRECTION_KEY_RE, PLATFORM_CODE_RE, getPlatform, isValidDirection } from "../network";
import { knownTrainsAt, type TrainSighting } from "../predict/sightings";
import { sightingApprovalStatus } from "../predict/readings";
import type { ReadingSource, ReadingStatus } from "../predict";
import { DAY, HOUR, MINUTE } from "../time";
import { HISTORY_DAYS, observationStore } from "./observations";

/** "I boarded" / "Got off" may be moved back at most 12 h. */
export const MAX_BACKDATE_MS = 12 * HOUR;

type Row = typeof trainSighting.$inferSelect;
export function toSighting(r: Row): TrainSighting {
  return {
    id: r.id,
    station: r.station,
    line: r.line,
    direction: r.direction,
    at: new Date(r.at).getTime(),
    kind: r.kind as TrainSighting["kind"],
    source: r.source as ReadingSource,
    status: r.status as ReadingStatus,
    destination: r.destination,
    tripEventId: r.tripEventId,
  };
}

export function sightingStore(db: Pick<Db, "select">) {
  return {
    /** Approved sightings on lines, recent history. */
    async forLines(lines: string[], now: number): Promise<TrainSighting[]> {
      if (!lines.length) return [];
      const rows = await db
        .select()
        .from(trainSighting)
        .where(and(inArray(trainSighting.line, lines), eq(trainSighting.status, "approved"), gte(trainSighting.at, new Date(now - HISTORY_DAYS * DAY))))
        .orderBy(desc(trainSighting.at))
        .limit(5000);
      return rows.map(toSighting);
    },
    /** Approved sightings on one line/direction within ±window of an instant (moderation). */
    async near(line: string, direction: string, at: number, windowMs: number): Promise<TrainSighting[]> {
      const rows = await db
        .select()
        .from(trainSighting)
        .where(
          and(
            eq(trainSighting.line, line),
            eq(trainSighting.direction, direction),
            eq(trainSighting.status, "approved"),
            gte(trainSighting.at, new Date(at - windowMs)),
            sql`${trainSighting.at} <= ${new Date(at + windowMs).toISOString()}::timestamptz`,
          ),
        )
        .limit(500);
      return rows.map(toSighting);
    },
  };
}

export async function loadSightings(lines: string[], now: number): Promise<TrainSighting[]> {
  if (!dbConfigured()) return [];
  return sightingStore(getDb()).forLines(lines, now).catch(() => []);
}

/* ---------- Trip events → sightings ---------- */

const SIGHTING_KIND: Record<string, TrainSighting["kind"]> = { board: "boarded", alight: "alighted" };

type TripRow = Pick<typeof tripEvent.$inferSelect, "id" | "userId" | "kind" | "at" | "station" | "line" | "direction" | "source">;

/** The sighting a trip event implies (board/alight at a known platform + direction), or null. */
export function sightingForTripEvent(e: TripRow) {
  const kind = SIGHTING_KIND[e.kind];
  const platform = e.station ? getPlatform(e.station) : undefined;
  if (!kind || !platform || !e.direction || !isValidDirection(platform.line, e.direction)) return null;
  return {
    station: platform.code,
    line: platform.line,
    direction: e.direction,
    at: new Date(e.at),
    kind,
    source: e.source === "hermes" ? "hermes" : "owner",
    status: "approved",
    tripEventId: e.id,
    userId: e.userId,
  } satisfies typeof trainSighting.$inferInsert;
}

/** Create, update or remove the sighting linked to a trip event (idempotent). */
export async function syncSightingForTripEvent(db: Pick<Db, "insert" | "delete">, e: TripRow): Promise<number | null> {
  const values = sightingForTripEvent(e);
  if (!values) {
    await db.delete(trainSighting).where(eq(trainSighting.tripEventId, e.id));
    return null;
  }
  const [row] = await db
    .insert(trainSighting)
    .values(values)
    .onConflictDoUpdate({
      target: trainSighting.tripEventId,
      set: { station: values.station, line: values.line, direction: values.direction, at: values.at, kind: values.kind, source: values.source },
    })
    .returning({ id: trainSighting.id });
  return row?.id ?? null;
}

/* ---------- Public sightings ---------- */

export const sightingInput = z.strictObject({
  station: z.string().regex(PLATFORM_CODE_RE),
  direction: z.string().regex(DIRECTION_KEY_RE),
  kind: z.enum(["boarded", "alighted"]),
  at: z.string().datetime({ offset: true }),
});
export type SightingInput = z.infer<typeof sightingInput>;

export function sightingTimeOk(at: number, now: number) {
  return Number.isFinite(at) && at <= now + 2 * MINUTE && at >= now - MAX_BACKDATE_MS - 2 * MINUTE;
}

/**
 * Save a public sighting: approved when it agrees (±2 min) with a train
 * already known at that platform within the same 30 min; pending otherwise
 * (the owner moderates it in admin).
 */
export async function savePublicSighting(input: SightingInput, meta: { deviceId: string | null; ipHash: string | null; now: number }) {
  const platform = getPlatform(input.station);
  if (!platform || !isValidDirection(platform.line, input.direction)) return { ok: false as const, error: "Unknown platform or direction" };
  const at = Date.parse(input.at);
  if (!sightingTimeOk(at, meta.now)) return { ok: false as const, error: "Time out of range" };
  const db = getDb();
  const window = 45 * MINUTE;
  const [sightings, readings] = await Promise.all([
    sightingStore(db).near(platform.line, input.direction, at, window),
    observationStore(db).forLines([platform.line], meta.now).then((obs) => obs.filter((o) => o.direction === input.direction && Math.abs(o.capturedAt - at) <= window)),
  ]);
  const known = knownTrainsAt({ station: platform.code, line: platform.line, direction: input.direction }, sightings, readings);
  const status = sightingApprovalStatus(at, known);
  const [row] = await db
    .insert(trainSighting)
    .values({
      station: platform.code,
      line: platform.line,
      direction: input.direction,
      at: new Date(at),
      kind: input.kind,
      source: "public",
      status,
      deviceId: meta.deviceId,
      ipHash: meta.ipHash,
    })
    .returning({ id: trainSighting.id });
  return { ok: true as const, id: row?.id ?? null, status, line: platform.line };
}
