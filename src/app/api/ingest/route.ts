import { z } from "zod";
import { eq } from "drizzle-orm";
import { dbConfigured, getDb } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { bearerMatches, json, noDb, readJson } from "@/lib/server/http";
import { readingInput, saveReading } from "@/lib/server/readings";
import { logTripEvent, tripEventInput } from "@/lib/server/trips";

const body = z.strictObject({
  readings: z.array(z.unknown()).max(50).optional(),
  tripEvents: z.array(z.unknown()).max(100).optional(),
  ownerEmail: z.email().optional(),
});

/**
 * POST /api/ingest (Bearer INGEST_TOKEN) — Hermes posts readings and trip
 * events it extracted from photos. Readings are saved as approved
 * (source "hermes"); trip events go to the owner (first ALLOWED_EMAILS
 * entry, or `ownerEmail` if it is on the allowlist). See docs/ingest-api.md.
 */
export async function POST(request: Request) {
  if (!process.env.INGEST_TOKEN) return json({ error: "Ingest is disabled" }, 503);
  if (!bearerMatches(request, process.env.INGEST_TOKEN)) return json({ error: "Unauthorized" }, 401);
  if (!dbConfigured()) return noDb();
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad body" }, 400);
  const now = Date.now();
  const results: { readings: unknown[]; tripEvents: unknown[] } = { readings: [], tripEvents: [] };

  for (const raw of parsed.data.readings ?? []) {
    const r = readingInput.safeParse(raw);
    if (!r.success) {
      results.readings.push({ ok: false, error: "invalid" });
      continue;
    }
    results.readings.push(await saveReading(r.data, { source: "hermes", status: "approved", now, origin: "hermes" }));
  }

  if (parsed.data.tripEvents?.length) {
    const allow = (process.env.ALLOWED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    const wanted = parsed.data.ownerEmail?.toLowerCase();
    const email = wanted && allow.includes(wanted) ? wanted : allow[0];
    const owner = email ? await getDb().query.user.findFirst({ where: eq(user.email, email) }) : null;
    if (!owner) return json({ ...results, error: "Owner has not signed in yet" }, 409);
    for (const raw of parsed.data.tripEvents) {
      const t = tripEventInput.safeParse(raw);
      results.tripEvents.push(t.success ? { ok: true, ...(await logTripEvent(owner.id, t.data, "hermes")) } : { ok: false, error: "invalid" });
    }
  }
  return json(results, 201);
}
