import { z } from "zod";
import { dbConfigured } from "@/lib/db";
import { json, readJson, sameOrigin } from "@/lib/server/http";
import { logAdEvent } from "@/lib/server/ads";
import { AD_PLACEMENTS } from "@/lib/ads/formats";
import { userTypeFor } from "@/lib/server/visitor";

const id = z.string().regex(/^[a-zA-Z0-9-]{8,64}$/);
const body = z.strictObject({
  type: z.enum(["impression", "viewable"]),
  creativeId: z.number().int().positive(),
  placement: z.enum(AD_PLACEMENTS),
  sessionId: id.nullish(),
  /** Sent only with analytics consent. */
  deviceId: id.nullish(),
});

/** POST /api/ads/event — impression (on render) or viewable (≥ 50 % for ≥ 1 s). Clicks go through /api/ads/click. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad event" }, 400);
  if (!dbConfigured()) return json({ ok: false });
  const internal = (await userTypeFor(request)) !== "visitor";
  const row = await logAdEvent({ ...parsed.data, sessionId: parsed.data.sessionId ?? null, deviceId: parsed.data.deviceId ?? null, internal }).catch(() => null);
  return row ? json({ ok: true }) : json({ error: "Unknown creative" }, 404);
}
