import { dbConfigured } from "@/lib/db";
import { json, noDb, readJson, sameOrigin } from "@/lib/server/http";
import { feedbackInput, saveFeedback } from "@/lib/server/voc";
import { userTypeFor } from "@/lib/server/visitor";

/** POST /api/feedback — free text stays in Neon; only rating+category go to analytics. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!dbConfigured()) return noDb();
  const parsed = feedbackInput.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad feedback" }, 400);
  await saveFeedback(parsed.data, await userTypeFor(request));
  return json({ ok: true }, 201);
}
