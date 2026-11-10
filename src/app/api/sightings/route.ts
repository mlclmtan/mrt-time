import { randomUUID } from "node:crypto";
import { and, eq, gte } from "drizzle-orm";
import { dbConfigured, getDb } from "@/lib/db";
import { trainSighting } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/server";
import { json, noDb, readJson, sameOrigin } from "@/lib/server/http";
import { publicRateLimit } from "@/lib/server/readings";
import { PUBLIC_MAX_BACKDATE_MS, savePublicSighting, sightingInput, sightingTimeOk } from "@/lib/server/sightings";
import { logTripEvent, undoTripEvent } from "@/lib/server/trips";
import { clientIp, dailyIpHash } from "@/lib/analytics/request";
import { timed } from "@/lib/server/metrics";
import { getPlatform } from "@/lib/network";
import { MINUTE } from "@/lib/time";

const DEVICE = /^[a-zA-Z0-9-]{8,64}$/;
const UNDO_WINDOW_MS = 2 * MINUTE;
const deviceFrom = (request: Request) => {
  const header = request.headers.get("x-device-id");
  return header && DEVICE.test(header) ? header : null;
};

/**
 * POST /api/sightings — "I boarded" / "Got off" `{ station, direction, kind: boarded|alighted, at, timeSource? }`.
 * The owner's taps (up to 12 h back) become trip events (and their
 * sighting); anyone else (up to 30 min back) shares the board-reading rate
 * limits (10/hour per device + daily IP hash, 20/hour per IP hash) and is
 * auto-approved only when consistent with trains the owner / Hermes put
 * there, or when a second network reports the same train.
 */
export const POST = timed("/api/sightings", async (request) => {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!dbConfigured()) return noDb();
  const parsed = sightingInput.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Please check the station, direction and time." }, 400);
  const now = Date.now();
  const at = Date.parse(parsed.data.at);
  if (!sightingTimeOk(at, now)) return json({ error: "Times can be at most 12 hours back." }, 400);
  const session = await getSession();
  if (session?.user.role === "owner") {
    const clientId = randomUUID();
    const platform = getPlatform(parsed.data.station);
    const saved = await logTripEvent(session.user.id, {
      clientId,
      kind: parsed.data.kind === "boarded" ? "board" : "alight",
      at: parsed.data.at,
      station: parsed.data.station,
      line: platform?.line,
      direction: parsed.data.direction,
      ...(parsed.data.timeSource ? { timeSource: parsed.data.timeSource } : {}),
    });
    return json({ ok: true, status: "approved", id: saved.sightingId, clientId, tripEventId: saved.id }, 201);
  }
  if (!sightingTimeOk(at, now, PUBLIC_MAX_BACKDATE_MS)) return json({ error: "Times can be at most 30 minutes back." }, 400);
  const deviceId = deviceFrom(request);
  const ipHash = dailyIpHash(clientIp(request.headers), now);
  const limit = await publicRateLimit(deviceId, ipHash, now);
  if (!limit.allowed) return json({ error: "Thanks! That's the limit for this hour.", status: "rate_limited" }, 429);
  const saved = await savePublicSighting(parsed.data, { deviceId, ipHash, now });
  return saved.ok ? json(saved, 201) : json({ error: saved.error }, 400);
});

/**
 * DELETE /api/sightings?id=N (visitor: own device / network, ≤ 2 min old)
 * or ?clientId= (owner: the 10-second undo of the trip event).
 */
export const DELETE = timed("/api/sightings", async (request) => {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!dbConfigured()) return noDb();
  const params = new URL(request.url).searchParams;
  const now = Date.now();
  const session = await getSession();
  if (session?.user.role === "owner" && params.has("clientId")) {
    const clientId = params.get("clientId") || "";
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Bad id" }, 400);
    const result = await undoTripEvent(session.user.id, clientId, now);
    return result.undone ? json({ ok: true }) : json({ error: "Too late to undo" }, 404);
  }
  const id = Number(params.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Unknown sighting" }, 400);
  const ipHash = dailyIpHash(clientIp(request.headers), now);
  const deviceId = deviceFrom(request);
  if (!ipHash && !deviceId) return json({ error: "Not allowed" }, 403);
  const rows = await getDb()
    .delete(trainSighting)
    .where(
      and(
        eq(trainSighting.id, id),
        eq(trainSighting.source, "public"),
        gte(trainSighting.createdAt, new Date(now - UNDO_WINDOW_MS)),
        ...(ipHash ? [eq(trainSighting.ipHash, ipHash)] : []),
        ...(deviceId ? [eq(trainSighting.deviceId, deviceId)] : []),
      ),
    )
    .returning({ id: trainSighting.id });
  return rows.length ? json({ ok: true }) : json({ error: "Too late to undo" }, 404);
});
