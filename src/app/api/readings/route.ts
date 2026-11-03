import { dbConfigured } from "@/lib/db";
import { getSession } from "@/lib/auth/server";
import { json, noDb, readJson, sameOrigin } from "@/lib/server/http";
import { readingInput, saveReading, publicRateLimit, PUBLIC_READING_LIMIT } from "@/lib/server/readings";
import { DbRateLimiter } from "@/lib/server/rate-limit";
import { clientIp, dailyIpHash } from "@/lib/analytics/request";
import { timed } from "@/lib/server/metrics";

/**
 * POST /api/readings — board reading. Owners save approved readings;
 * anyone else is rate limited (10/hour per device + daily IP hash) and
 * auto-approved only when consistent with known data.
 */
export const POST = timed("/api/readings", async (request) => {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!dbConfigured()) return noDb();
  const body = (await readJson(request)) as Record<string, unknown> | null;
  const deviceId = typeof body?.deviceId === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(body.deviceId) ? body.deviceId : null;
  const parsed = readingInput.safeParse(body?.reading);
  if (!parsed.success) return json({ error: "Please check the station, direction and minutes." }, 400);
  const now = Date.now();
  const session = await getSession();
  if (session?.user.role === "owner") {
    const saved = await saveReading(parsed.data, { source: "owner", status: "approved", userId: session.user.id, now, origin: "app" });
    return saved.ok ? json(saved, 201) : json({ error: saved.error }, 400);
  }
  const ipHash = dailyIpHash(clientIp(request.headers), now);
  const limit = await publicRateLimit(new DbRateLimiter("public_reading", PUBLIC_READING_LIMIT), deviceId, ipHash, now);
  if (!limit.allowed) return json({ error: "Thanks! That's the limit for this hour.", status: "rate_limited" }, 429);
  const saved = await saveReading(parsed.data, { source: "public", deviceId, ipHash, now });
  return saved.ok ? json(saved, 201) : json({ error: saved.error }, 400);
});
