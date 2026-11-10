import { and, eq, gte } from "drizzle-orm";
import { dbConfigured, getDb } from "@/lib/db";
import { observation } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/server";
import { json, noDb, readJson, sameOrigin } from "@/lib/server/http";
import { parseReadingBody, saveReading, publicRateLimit, PUBLIC_SEEN_AGO_MAX_MIN } from "@/lib/server/readings";
import { clientIp, dailyIpHash } from "@/lib/analytics/request";
import { timed } from "@/lib/server/metrics";
import { MINUTE } from "@/lib/time";

const DEVICE = /^[a-zA-Z0-9-]{8,64}$/;
const UNDO_WINDOW_MS = 2 * MINUTE;

function deviceFrom(request: Request, body: Record<string, unknown> | null) {
  const header = request.headers.get("x-device-id");
  if (header && DEVICE.test(header)) return header;
  return typeof body?.deviceId === "string" && DEVICE.test(body.deviceId) ? body.deviceId : null;
}

/**
 * POST /api/readings — board reading `{ station, direction, minutes[], seenAt }`
 * (the legacy `{ deviceId, reading }` shape is still accepted). Owners save
 * approved readings; anyone else is rate limited (10/hour per device +
 * daily IP hash), may date a reading at most 30 min back, and is
 * auto-approved only when consistent with known data.
 */
export const POST = timed("/api/readings", async (request) => {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!dbConfigured()) return noDb();
  const body = (await readJson(request)) as Record<string, unknown> | null;
  const deviceId = deviceFrom(request, body);
  const parsed = parseReadingBody(body);
  if (!parsed) return json({ error: "Please check the station, direction and minutes." }, 400);
  const now = Date.now();
  const session = await getSession();
  if (session?.user.role === "owner") {
    const saved = await saveReading(parsed, { source: "owner", status: "approved", userId: session.user.id, now, origin: "app" });
    return saved.ok ? json(saved, 201) : json({ error: saved.error }, 400);
  }
  if (parsed.capturedAt && Date.parse(parsed.capturedAt) < now - PUBLIC_SEEN_AGO_MAX_MIN * MINUTE)
    return json({ error: "Readings can be at most 30 minutes old." }, 400);
  const ipHash = dailyIpHash(clientIp(request.headers), now);
  const limit = await publicRateLimit(deviceId, ipHash, now);
  if (!limit.allowed) return json({ error: "Thanks! That's the limit for this hour.", status: "rate_limited" }, 429);
  const saved = await saveReading(parsed, { source: "public", deviceId, ipHash, now });
  return saved.ok ? json(saved, 201) : json({ error: saved.error }, 400);
});

/**
 * DELETE /api/readings?id=N — the 10-second undo. Owners undo their own
 * readings; a visitor can only undo a reading sent from the same network
 * (daily IP hash) / device in the last 2 minutes.
 */
export const DELETE = timed("/api/readings", async (request) => {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!dbConfigured()) return noDb();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Unknown reading" }, 400);
  const now = Date.now();
  const recent = gte(observation.createdAt, new Date(now - UNDO_WINDOW_MS));
  const session = await getSession();
  let where;
  if (session?.user.role === "owner") {
    where = and(eq(observation.id, id), eq(observation.userId, session.user.id), recent);
  } else {
    const ipHash = dailyIpHash(clientIp(request.headers), now);
    const deviceId = deviceFrom(request, null);
    if (!ipHash && !deviceId) return json({ error: "Not allowed" }, 403);
    where = and(
      eq(observation.id, id),
      eq(observation.source, "public"),
      recent,
      ...(ipHash ? [eq(observation.ipHash, ipHash)] : []),
      ...(deviceId ? [eq(observation.deviceId, deviceId)] : []),
    );
  }
  const rows = await getDb().delete(observation).where(where).returning({ id: observation.id });
  return rows.length ? json({ ok: true }) : json({ error: "Too late to undo" }, 404);
});
