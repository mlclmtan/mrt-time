/**
 * Backfill train sightings for trip events logged before v2.0.0: every
 * `board` / `alight` event with a platform and direction gets one sighting
 * (linked by trip_event_id). Idempotent — re-running updates the same rows
 * (unique trip_event_id), never duplicates them. Board readings need no
 * backfill: their sightings are derived from `observation` on the fly.
 *
 * v2.1: sightings without an error (`error_min` null — every row before
 * migration 0003) get one from their trip event: logged within a minute of
 * its time → ±0.5 (a tap at Now), else ±1; and their `created_at` is set to
 * the event's, so a sighting backfilled later doesn't look back-dated
 * (accuracy only scores boardings logged as they happened).
 *
 *   pnpm sightings:backfill            # uses DATABASE_URL from .env.local / .env (run by Hermes)
 *   pnpm sightings:backfill --dry-run  # count what would be written
 */
import { config } from "dotenv";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import type { Db as AppDb } from "../src/lib/db";
import { sightingForTripEvent, syncSightingForTripEvent, tapErrorFor } from "../src/lib/server/sightings";

type Db = Pick<AppDb, "select" | "insert" | "delete" | "update">;

const BATCH = 500;

export async function backfillSightings(db: Db, opts: { dryRun?: boolean } = {}) {
  let lastId = 0;
  let scanned = 0;
  let written = 0;
  let errors = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(schema.tripEvent)
      .where(and(inArray(schema.tripEvent.kind, ["board", "alight"]), gt(schema.tripEvent.id, lastId)))
      .orderBy(asc(schema.tripEvent.id))
      .limit(BATCH);
    if (!rows.length) break;
    for (const row of rows) {
      scanned++;
      if (!sightingForTripEvent(row)) continue;
      written++;
      if (opts.dryRun) continue;
      await syncSightingForTripEvent(db, row);
      // v2.1: an error from the event's own logging lag, only where none is stored yet.
      const errorMin = tapErrorFor({}, new Date(row.at).getTime(), new Date(row.createdAt).getTime());
      const fixed = await db
        .update(schema.trainSighting)
        .set({ errorMin, createdAt: row.createdAt })
        .where(and(eq(schema.trainSighting.tripEventId, row.id), isNull(schema.trainSighting.errorMin)))
        .returning({ id: schema.trainSighting.id });
      errors += fixed.length;
    }
    lastId = rows[rows.length - 1].id;
  }
  return { scanned, written, errors };
}

async function main() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  const { neon } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-http");
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });
  const dryRun = process.argv.includes("--dry-run");
  const result = await backfillSightings(db as unknown as Db, { dryRun });
  console.log(`${dryRun ? "Would write" : "Wrote"} ${result.written} sightings from ${result.scanned} board/alight events; set the error on ${result.errors}.`);
}

if (process.argv[1]?.endsWith("backfill-sightings.ts"))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
