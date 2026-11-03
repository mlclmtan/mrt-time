import { z } from "zod";
import { deliverUrl, schedulingAvailable } from "@/lib/push/config";
import { verifyQStash } from "@/lib/push/qstash";
import { sendToUser } from "@/lib/push/send";
import { json } from "@/lib/server/http";

const body = z.object({
  userId: z.string().min(1).max(100),
  message: z.object({ title: z.string().max(100), body: z.string().max(300), tag: z.string().max(60), url: z.string().startsWith("/").max(200) }),
});

/** QStash → deliver a scheduled push (signature verified). */
export async function POST(request: Request) {
  if (!schedulingAvailable()) return json({ error: "Not configured" }, 503);
  const verified = await verifyQStash(request, deliverUrl());
  if (!verified.ok) return verified.response;
  let parsed;
  try {
    parsed = body.safeParse(JSON.parse(verified.body));
  } catch {
    return json({ error: "Bad body" }, 400);
  }
  if (!parsed.success) return json({ error: "Bad body" }, 400);
  return json(await sendToUser(parsed.data.userId, parsed.data.message, { ttl: 300 }));
}
