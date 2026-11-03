import { dbConfigured } from "@/lib/db";
import { json, noDb, readJson, sameOrigin } from "@/lib/server/http";
import { newsletterInput, subscribe } from "@/lib/server/voc";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!dbConfigured()) return noDb();
  const parsed = newsletterInput.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Please enter a valid email and tick the consent box." }, 400);
  return json(await subscribe(parsed.data), 201);
}
