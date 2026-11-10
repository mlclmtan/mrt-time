/**
 * Train sightings (boarded / got off). Reads are keyed by line + direction
 * and bounded in time, like observations. Owner and Hermes sightings come
 * from trip events (one sighting per board/alight event, linked by id);
 * public ones come from POST /api/sightings. Only the origin sighting is
 * stored: propagation along the line happens at read time (predict/sightings.ts).
 */
import { and, desc, eq, gte, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { dbConfigured, getDb, type Db } from "../db";
import { trainSighting, tripEvent } from "../db/schema";
import { DIRECTION_KEY_RE, PLATFORM_CODE_RE, getPlatform, isValidDirection } from "../network";
import { CORROBORATE_MIN, NOW_TAP_LAG_MS, knownTrainsAt, linkRides, tapError, type TrainSighting } from "../predict/sightings";
import { sightingApprovalStatus } from "../predict/readings";
import type { ReadingSource, ReadingStatus } from "../predict";
import { DAY, HOUR, MINUTE } from "../time";
import { HISTORY_DAYS, observationStore } from "./observations";

/** The owner's "I boarded" / "Got off" may be moved back at most 12 h. */
export const MAX_BACKDATE_MS = 12 * HOUR;
/** Public taps: at most 30 min back (like board readings). */
export const PUBLIC_MAX_BACKDATE_MS = 30 * MINUTE;
const SLACK_MS = 2 * MINUTE;

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
    errMin: r.errorMin,
    recordedAt: r.createdAt ? new Date(r.createdAt).getTime() : undefined,
    editedAt: r.editedAt ? new Date(r.editedAt).getTime() : null,
    userId: r.userId,
    ipHash: r.ipHash,
  };
}

/** Approved sightings, plus public ones awaiting review (two networks agreeing makes them count). */
const usable = or(eq(trainSighting.status, "approved"), and(eq(trainSighting.status, "pending"), eq(trainSighting.source, "public")));

export function sightingStore(db: Pick<Db, "select">) {
  return {
    /** Sightings on lines, recent history (approved + public pending), boardings paired with their getting off. */
    async forLines(lines: string[], now: number): Promise<TrainSighting[]> {
      if (!lines.length) return [];
      const rows = await db
        .select()
        .from(trainSighting)
        .where(and(inArray(trainSighting.line, lines), usable, gte(trainSighting.at, new Date(now - HISTORY_DAYS * DAY))))
        .orderBy(desc(trainSighting.at))
        .limit(5000);
      return linkRides(rows.map(toSighting));
    },
    /** Sightings on one line/direction within ±window of an instant (moderation). */
    async near(line: string, direction: string, at: number, windowMs: number): Promise<TrainSighting[]> {
      const rows = await db
        .select()
        .from(trainSighting)
        .where(
          and(
            eq(trainSighting.line, line),
            eq(trainSighting.direction, direction),
            usable,
            gte(trainSighting.at, new Date(at - windowMs)),
            sql`${trainSighting.at} <= ${new Date(at + windowMs).toISOString()}::timestamptz`,
          ),
        )
        .limit(500);
      return linkRides(rows.map(toSighting));
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
export function sightingForTripEvent(e: TripRow, opts: { errorMin?: number | null } = {}) {
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
    ...(opts.errorMin != null ? { errorMin: opts.errorMin } : {}),
  } satisfies typeof trainSighting.$inferInsert;
}

/**
 * Create, update or remove the sighting linked to a trip event (idempotent).
 * `errorMin` is stored when known; `edited` marks a timeline edit (never scored).
 */
export async function syncSightingForTripEvent(
  db: Pick<Db, "insert" | "delete">,
  e: TripRow,
  opts: { errorMin?: number | null; edited?: boolean } = {},
): Promise<number | null> {
  const values = sightingForTripEvent(e, opts);
  if (!values) {
    await db.delete(trainSighting).where(eq(trainSighting.tripEventId, e.id));
    return null;
  }
  const editedAt = opts.edited ? new Date() : undefined;
  const [row] = await db
    .insert(trainSighting)
    .values({ ...values, ...(editedAt ? { editedAt } : {}) })
    .onConflictDoUpdate({
      target: trainSighting.tripEventId,
      set: {
        station: values.station,
        line: values.line,
        direction: values.direction,
        at: values.at,
        kind: values.kind,
        source: values.source,
        ...(opts.errorMin != null ? { errorMin: opts.errorMin } : {}),
        ...(editedAt ? { editedAt } : {}),
      },
    })
    .returning({ id: trainSighting.id });
  return row?.id ?? null;
}

/**
 * ± minutes of a tap: the client says whether the time was moved with the
 * chips / picker; older clients don't, so a tap received more than a
 * minute after its time counts as chosen (±1), else as Now (±0.5).
 */
export function tapErrorFor(input: { timeSource?: "now" | "chosen" }, at: number, receivedAt: number): number {
  if (input.timeSource) return tapError(input.timeSource === "chosen");
  return tapError(receivedAt - at > NOW_TAP_LAG_MS);
}

/* ---------- Public sightings ---------- */

export const sightingInput = z.strictObject({
  station: z.string().regex(PLATFORM_CODE_RE),
  direction: z.string().regex(DIRECTION_KEY_RE),
  kind: z.enum(["boarded", "alighted"]),
  at: z.string().datetime({ offset: true }),
  /** "now" = tapped at Now; "chosen" = moved back with the chips / picker. Optional (old clients). */
  timeSource: z.enum(["now", "chosen"]).optional(),
});
export type SightingInput = z.infer<typeof sightingInput>;

/** Owner: up to 12 h back; public: up to 30 min back (2 min slack either way). */
export function sightingTimeOk(at: number, now: number, maxBackMs = MAX_BACKDATE_MS) {
  return Number.isFinite(at) && at <= now + SLACK_MS && at >= now - maxBackMs - SLACK_MS;
}

/**
 * Save a public sighting: approved when it agrees (±2 min) with a train the
 * owner / Hermes already put at that platform within the same 30 min, or
 * when another network reported the same train (±1 min); pending otherwise
 * (the owner moderates it in admin). It never propagates on its own.
 */
export async function savePublicSighting(input: SightingInput, meta: { deviceId: string | null; ipHash: string | null; now: number }) {
  const platform = getPlatform(input.station);
  if (!platform || !isValidDirection(platform.line, input.direction)) return { ok: false as const, error: "Unknown platform or direction" };
  const at = Date.parse(input.at);
  if (!sightingTimeOk(at, meta.now, PUBLIC_MAX_BACKDATE_MS)) return { ok: false as const, error: "Time out of range" };
  const db = getDb();
  const window = 45 * MINUTE;
  const [sightings, readings] = await Promise.all([
    sightingStore(db).near(platform.line, input.direction, at, window),
    observationStore(db).forLines([platform.line], meta.now).then((obs) => obs.filter((o) => o.direction === input.direction && Math.abs(o.capturedAt - at) <= window)),
  ]);
  const known = knownTrainsAt({ station: platform.code, line: platform.line, direction: input.direction }, sightings, readings);
  const otherNetwork = sightings.some(
    (s) => s.source === "public" && s.station === platform.code && s.ipHash && s.ipHash !== meta.ipHash && Math.abs(s.at - at) <= CORROBORATE_MIN * MINUTE,
  );
  const status: ReadingStatus = otherNetwork ? "approved" : sightingApprovalStatus(at, known);
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
      errorMin: tapErrorFor(input, at, meta.now),
    })
    .returning({ id: trainSighting.id });
  // The other network's matching tap is confirmed too.
  if (otherNetwork && meta.ipHash)
    await db
      .update(trainSighting)
      .set({ status: "approved" })
      .where(
        and(
          eq(trainSighting.source, "public"),
          eq(trainSighting.status, "pending"),
          eq(trainSighting.station, platform.code),
          eq(trainSighting.direction, input.direction),
          ne(trainSighting.ipHash, meta.ipHash),
          gte(trainSighting.at, new Date(at - CORROBORATE_MIN * MINUTE)),
          sql`${trainSighting.at} <= ${new Date(at + CORROBORATE_MIN * MINUTE).toISOString()}::timestamptz`,
        ),
      );
  return { ok: true as const, id: row?.id ?? null, status, line: platform.line };
}
