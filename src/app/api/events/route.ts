import { after } from "next/server";
import { buildEventRow, storeEvent } from "@/lib/analytics/ingest";
import { dbConfigured } from "@/lib/db";
import { json, sameOrigin } from "@/lib/server/http";
import { userTypeFor } from "@/lib/server/visitor";

/** POST /api/events — { events: Envelope[] } (sendBeacon friendly, ≤ 20 per call). */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  const text = await request.text();
  if (text.length > 32_000) return json({ error: "Too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const events = (body as { events?: unknown[] })?.events;
  if (!Array.isArray(events) || events.length > 20) return json({ error: "Bad batch" }, 400);
  const userType = await userTypeFor(request);
  const origin = new URL(request.url).origin;
  const now = Date.now();
  const results = events.map((e) => buildEventRow(e, { headers: request.headers, userType, now, origin }));
  const accepted = results.filter((r) => r.ok);
  if (dbConfigured() && accepted.length)
    after(async () => {
      for (const r of accepted) await storeEvent(r).catch(() => undefined);
    });
  return json({ accepted: accepted.length, rejected: results.length - accepted.length });
}
