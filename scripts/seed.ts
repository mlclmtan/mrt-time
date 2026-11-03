/**
 * Upsert the owner's private data from private/seed.json (gitignored) into
 * the database: profile places, journeys (with best-door tips), board
 * observations and trip events. Never commit the seed file or its values.
 *
 *   pnpm db:seed               # uses DATABASE_URL from .env.local / .env
 *   pnpm db:seed --dry-run     # validate and print counts only
 */
import { config } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const num = z.number().finite();
const seedSchema = z.object({
  profile: z.object({
    owner_email: z.email(),
    home: z.object({ label: z.string(), address: z.string().optional(), lat: num.optional(), lng: num.optional(), station: z.string().optional(), exit: z.string().optional() }),
    office: z.object({ label: z.string(), address: z.string().optional(), lat: num.optional(), lng: num.optional(), station: z.string().optional(), exit: z.string().optional() }),
    legs_min: z.record(z.string(), num),
    best_doors: z
      .array(z.object({ line: z.string(), from_: z.string(), to: z.string(), direction: z.string(), door: z.string(), why: z.string().optional() }))
      .default([]),
    notes: z.array(z.string()).optional(),
  }),
  observations: z.array(
    z.object({
      capturedAt: z.string(),
      station: z.string(),
      line: z.string(),
      direction: z.string(),
      destCode: z.string().nullish(),
      destName: z.string().nullish(),
      nextMin: num,
      nextNextMin: num.nullish(),
      thirdMin: num.nullish(),
      source: z.string().nullish(),
    }),
  ),
  trips: z.array(
    z.object({
      date: z.string(),
      direction: z.string(),
      route: z.string().optional(),
      events: z.array(
        z.object({
          at: z.string(),
          kind: z.string(),
          station: z.string().nullish(),
          line: z.string().nullish(),
          direction: z.string().nullish(),
          note: z.string().nullish(),
        }),
      ),
    }),
  ),
});
type Seed = z.infer<typeof seedSchema>;

type Leg =
  | { kind: "walk"; min: number; label?: string; tip?: string }
  | { kind: "ride"; line: string; from: string; to: string; direction: string; rideMin?: number; tip?: string }
  | { kind: "transfer"; min: number; at?: string; tip?: string };

/** Journeys from the owner's fixed leg minutes (keys in profile.legs_min). */
export function buildJourneys(seed: Seed) {
  const m = seed.profile.legs_min;
  const v = (key: string, fallback: number) => (typeof m[key] === "number" ? m[key] : fallback);
  const tipFor = (line: string, from: string, to: string, direction: string) => {
    const hit = seed.profile.best_doors.find(
      (d) => d.line === line && d.direction === direction && (d.from_ === from || d.to === to),
    );
    return hit ? `Door ${hit.door}${hit.why ? ` — ${hit.why}` : ""}` : undefined;
  };
  const ride = (line: string, from: string, to: string, direction: string, rideMin: number): Leg => ({
    kind: "ride",
    line,
    from,
    to,
    direction,
    rideMin,
    tip: tipFor(line, from, to, direction),
  });
  const transfer = v("transfer_ew16_te17_typ", v("transfer_ew16_te17_min", 4));
  return [
    {
      key: "home_to_office",
      name: "Home → Office",
      fromPlace: "home",
      toPlace: "office",
      sheltered: true,
      sort: 0,
      legs: [
        { kind: "walk", min: v("door_to_tapin", 6) + v("tapin_to_platform", 2), label: "Home → EW17 platform" },
        ride("EWL", "EW17", "EW16", "TO_EAST", v("ewl_ew17_ew16", 3)),
        { kind: "transfer", min: transfer, at: "outram-park" },
        ride("TEL", "TE17", "TE19", "TO_BAYSHORE", v("tel_te17_te19", 3)),
        { kind: "walk", min: v("te19_alight_to_desk", v("te19_alight_to_tapout", 1) + v("te19_tapout_to_desk", 4)), label: "TE19 → Office" },
      ] satisfies Leg[],
    },
    {
      key: "office_to_home",
      name: "Office → Home",
      fromPlace: "office",
      toPlace: "home",
      sheltered: true,
      sort: 1,
      legs: [
        { kind: "walk", min: v("te19_alight_to_desk", 5), label: "Office → TE19 platform" },
        ride("TEL", "TE19", "TE17", "TO_NORTH", v("tel_te17_te19", 3)),
        { kind: "transfer", min: transfer, at: "outram-park" },
        ride("EWL", "EW16", "EW17", "TO_WEST", v("ewl_ew17_ew16", 3)),
        { kind: "walk", min: v("ew17_tapout_to_lift", 3) + v("lift_to_door", 2), label: "EW17 → Home" },
      ] satisfies Leg[],
    },
    {
      key: "office_to_home_tp",
      name: "Office → Home via Tanjong Pagar",
      fromPlace: "office",
      toPlace: "home",
      sheltered: false,
      sort: 2,
      legs: [
        { kind: "walk", min: v("desk_to_ew15_tapin", 10) + v("tapin_to_platform", 2), label: "Office → EW15 platform" },
        ride("EWL", "EW15", "EW17", "TO_WEST", v("ewl_ew15_ew17", 5)),
        { kind: "walk", min: v("ew17_tapout_to_lift", 3) + v("lift_to_door", 2), label: "EW17 → Home" },
      ] satisfies Leg[],
    },
  ];
}

/** Stable client id per trip event so re-seeding is idempotent. */
function stableUuid(text: string) {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const path = join(process.cwd(), "private", "seed.json");
  const seed = seedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const journeys = buildJourneys(seed);
  const eventCount = seed.trips.reduce((s, t) => s + t.events.length, 0);
  console.log(`Seed OK: ${seed.observations.length} observations, ${seed.trips.length} trips (${eventCount} events), ${journeys.length} journeys.`);
  if (dryRun) return;
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to seed.");

  const { getDb } = await import("../src/lib/db");
  const s = await import("../src/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { platformPrediction } = await import("../src/lib/server/board");
  const { scorePrediction } = await import("../src/lib/predict/accuracy");
  const { timeBand } = await import("../src/lib/predict");
  const db = getDb();
  const email = seed.profile.owner_email.trim().toLowerCase();

  let owner = await db.query.user.findFirst({ where: eq(s.user.email, email) });
  if (!owner) {
    [owner] = await db.insert(s.user).values({ id: randomUUID(), name: "Owner", email, emailVerified: true }).returning();
  }
  const userId = owner!.id;

  for (const key of ["home", "office"] as const) {
    const p = seed.profile[key];
    const values = { label: p.label, address: p.address ?? null, lat: p.lat ?? null, lng: p.lng ?? null, station: p.station ?? null, exit: p.exit ?? null, updatedAt: new Date() };
    await db.insert(s.place).values({ userId, key, ...values }).onConflictDoUpdate({ target: [s.place.userId, s.place.key], set: values });
  }

  for (const j of journeys) {
    const values = { name: j.name, fromPlace: j.fromPlace, toPlace: j.toPlace, legs: j.legs, sheltered: j.sheltered, sort: j.sort, active: true, updatedAt: new Date() };
    await db.insert(s.journey).values({ userId, key: j.key, ...values }).onConflictDoUpdate({ target: [s.journey.userId, s.journey.key], set: values });
  }

  let obs = 0;
  for (const o of seed.observations) {
    const minutes = [o.nextMin, o.nextNextMin, o.thirdMin].filter((x): x is number => typeof x === "number");
    const rows = await db
      .insert(s.observation)
      .values({
        station: o.station,
        line: o.line,
        direction: o.direction,
        destination: o.destName ?? o.destCode ?? null,
        capturedAt: new Date(o.capturedAt),
        minutes,
        source: "owner",
        status: "approved",
        origin: o.source ?? "seed",
        userId,
      })
      .onConflictDoNothing()
      .returning({ id: s.observation.id });
    obs += rows.length;
  }

  let events = 0;
  for (const trip of seed.trips) {
    for (const e of trip.events) {
      const at = new Date(e.at);
      const rows = await db
        .insert(s.tripEvent)
        .values({
          userId,
          clientId: stableUuid(`${trip.date}|${trip.direction}|${e.kind}|${e.at}`),
          journeyKey: trip.direction,
          tripDate: trip.date,
          kind: e.kind,
          at,
          station: e.station ?? null,
          line: e.line ?? null,
          direction: e.direction ?? null,
          note: e.note ?? null,
          source: "seed",
        })
        .onConflictDoNothing()
        .returning({ id: s.tripEvent.id });
      events += rows.length;
      // Accuracy history: what we would have predicted at each boarding.
      if (rows[0] && e.kind === "board" && e.station && e.direction && e.line) {
        const prediction = await platformPrediction(e.station, e.direction, at.getTime());
        if (prediction) {
          const check = scorePrediction(prediction, at.getTime());
          await db.insert(s.predictionCheck).values({
            tripEventId: rows[0].id,
            line: e.line,
            station: e.station,
            direction: e.direction,
            band: timeBand(at.getTime()),
            boardedAt: at,
            predictedAt: check.predictedAt ? new Date(check.predictedAt) : null,
            kind: prediction.kind,
            basis: prediction.basis,
            confidence: prediction.confidence,
            errorMin: check.errorMin,
            hit: check.hit,
          });
        }
      }
    }
  }
  console.log(`Upserted places + ${journeys.length} journeys; inserted ${obs} new observations and ${events} new trip events.`);
}

if (process.argv[1]?.endsWith("seed.ts"))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
