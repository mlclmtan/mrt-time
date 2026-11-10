/**
 * Backfill train sightings for trip events logged before v2.0.0: every
 * `board` / `alight` event with a platform and direction gets one sighting
 * (linked by trip_event_id). Idempotent — re-running updates the same rows
 * (unique trip_event_id), never duplicates them. Board readings need no
 * backfill: their sightings are derived from `observation` on the fly.
 *
 *   pnpm sightings:backfill            # uses DATABASE_URL from .env.local / .env (run by Hermes)
 *   pnpm sightings:backfill --dry-run  # count what would be written
 */
import { config } from "dotenv";
import { and, asc, gt, inArray } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import type { Db as AppDb } from "../src/lib/db";
import { sightingForTripEvent, syncSightingForTripEvent } from "../src/lib/server/sightings";

type Db = Pick<AppDb, "select" | "insert" | "delete">;

const BATCH = 500;

export async function backfillSightings(db: Db, opts: { dryRun?: boolean } = {}) {
  let lastId = 0;
  let scanned = 0;
  let written = 0;
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
      if (!opts.dryRun) await syncSightingForTripEvent(db, row);
    }
    lastId = rows[rows.length - 1].id;
  }
  return { scanned, written };
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
  console.log(`${dryRun ? "Would write" : "Wrote"} ${result.written} sightings from ${result.scanned} board/alight events.`);
}

if (process.argv[1]?.endsWith("backfill-sightings.ts"))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
