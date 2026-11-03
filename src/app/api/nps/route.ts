import { dbConfigured } from "@/lib/db";
import { json, noDb, readJson, sameOrigin } from "@/lib/server/http";
import { npsInput, saveNps } from "@/lib/server/voc";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
  if (!dbConfigured()) return noDb();
  const parsed = npsInput.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad score" }, 400);
  await saveNps(parsed.data);
  return json({ ok: true }, 201);
}
