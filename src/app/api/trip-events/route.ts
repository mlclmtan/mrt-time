import { dbConfigured } from "@/lib/db";
import { json, noDb, readJson, requireRole } from "@/lib/server/http";
import { logTripEvent, tripEventInput, undoTripEvent } from "@/lib/server/trips";

/** POST — owner one-tap log (timestamp = the tap, sent by the client). */
export async function POST(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!dbConfigured()) return noDb();
  const parsed = tripEventInput.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad event" }, 400);
  return json(await logTripEvent(auth.user.id, parsed.data), 201);
}

/** DELETE ?clientId= — undo within 10 s. */
export async function DELETE(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!dbConfigured()) return noDb();
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Bad id" }, 400);
  return json(await undoTripEvent(auth.user.id, clientId));
}
