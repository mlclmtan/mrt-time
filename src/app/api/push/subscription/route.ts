import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { pushSubscription } from "@/lib/db/schema";
import { pushAvailable } from "@/lib/push/config";
import { subscriptionSchema } from "@/lib/push/endpoint";
import { json, readJson, requireRole } from "@/lib/server/http";

export async function POST(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!pushAvailable()) return json({ error: "Push is not configured" }, 503);
  const parsed = subscriptionSchema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad subscription" }, 400);
  const { endpoint, keys } = parsed.data;
  await getDb()
    .insert(pushSubscription)
    .values({ userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null })
    .onConflictDoUpdate({ target: pushSubscription.endpoint, set: { userId: auth.user.id, p256dh: keys.p256dh, auth: keys.auth } });
  return json({ ok: true }, 201);
}

export async function DELETE(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!pushAvailable()) return json({ ok: true });
  const endpoint = ((await readJson(request)) as { endpoint?: string } | null)?.endpoint;
  if (endpoint)
    await getDb().delete(pushSubscription).where(and(eq(pushSubscription.userId, auth.user.id), eq(pushSubscription.endpoint, endpoint)));
  return json({ ok: true });
}
