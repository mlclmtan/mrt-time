import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSetting, journey, user } from "@/lib/db/schema";
import { disruptionsUrl, schedulingAvailable } from "@/lib/push/config";
import { disruptionMessage } from "@/lib/push/disruptions";
import { verifyQStash } from "@/lib/push/qstash";
import { sendToUser } from "@/lib/push/send";
import { json } from "@/lib/server/http";
import { lineAlerts } from "@/lib/server/lta";
import { legsSchema } from "@/lib/server/journeys";
import { roleFor } from "@/lib/auth/access";

/**
 * QStash schedule (every 5 min in service hours, see scripts/qstash-schedules.ts):
 * push a disruption alert to owners whose saved journeys use an affected line.
 */
export async function POST(request: Request) {
  if (!schedulingAvailable()) return json({ error: "Not configured" }, 503);
  const verified = await verifyQStash(request, disruptionsUrl());
  if (!verified.ok) return verified.response;
  const alerts = await lineAlerts();
  const db = getDb();
  const rows = await db.select({ userId: journey.userId, legs: journey.legs, email: user.email }).from(journey).innerJoin(user, eq(user.id, journey.userId)).where(eq(journey.active, true));
  const byUser = new Map<string, Set<string>>();
  for (const r of rows) {
    if (roleFor(r.email) !== "owner") continue;
    const legs = legsSchema.safeParse(r.legs);
    if (!legs.success) continue;
    const set = byUser.get(r.userId) ?? new Set<string>();
    for (const l of legs.data) if (l.kind === "ride") set.add(l.line);
    byUser.set(r.userId, set);
  }
  let sent = 0;
  for (const [userId, lines] of byUser) {
    const result = disruptionMessage(alerts, [...lines]);
    const key = `last_disruption:${userId}`;
    const last = await db.query.appSetting.findFirst({ where: eq(appSetting.key, key) });
    const lastHash = (last?.value as { hash?: string } | undefined)?.hash ?? null;
    if (!result) {
      if (lastHash) await db.delete(appSetting).where(eq(appSetting.key, key));
      continue;
    }
    if (result.hash === lastHash) continue;
    await sendToUser(userId, result.message, { ttl: 600 });
    await db
      .insert(appSetting)
      .values({ key, value: { hash: result.hash } })
      .onConflictDoUpdate({ target: appSetting.key, set: { value: { hash: result.hash }, updatedAt: new Date() } });
    sent++;
  }
  return json({ sent });
}
