import { z } from "zod";
import { deliverUrl, schedulingAvailable } from "@/lib/push/config";
import { failureReason, qstashClient } from "@/lib/push/qstash";
import { json, readJson, requireRole } from "@/lib/server/http";
import { sgtClock } from "@/lib/time";

const body = z.strictObject({
  leaveAt: z.string().datetime({ offset: true }),
  journeyName: z.string().max(60),
  arriveAt: z.string().datetime({ offset: true }).optional(),
});

/** POST — schedule a "leave now" push one minute before leaveAt (QStash). */
export async function POST(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!schedulingAvailable()) return json({ error: "Reminders are not configured" }, 503);
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad reminder" }, 400);
  const leaveAt = Date.parse(parsed.data.leaveAt);
  const fireAt = Math.max(Date.now() + 5_000, leaveAt - 60_000);
  if (leaveAt - Date.now() > 12 * 3_600_000) return json({ error: "Too far ahead" }, 400);
  try {
    const result = await qstashClient().publishJSON({
      url: deliverUrl(),
      notBefore: Math.floor(fireAt / 1000),
      body: {
        userId: auth.user.id,
        message: {
          title: `Leave now · ${parsed.data.journeyName}`,
          body: `Leave by ${sgtClock(leaveAt)}${parsed.data.arriveAt ? ` to arrive ${sgtClock(Date.parse(parsed.data.arriveAt))}` : ""}.`,
          tag: "mrt:leave",
          url: "/",
        },
      },
    });
    return json({ ok: true, messageId: result.messageId, fireAt });
  } catch (error) {
    return json({ error: failureReason(error) }, 502);
  }
}
