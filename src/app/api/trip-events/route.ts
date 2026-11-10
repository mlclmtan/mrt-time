import { dbConfigured } from "@/lib/db";
import { json, noDb, readJson, requireRole } from "@/lib/server/http";
import { deleteTripEvent, logTripEvent, todaysEvents, tripEventInput, tripEventPatch, undoTripEvent, updateTripEvent } from "@/lib/server/trips";
import { sightingTimeOk } from "@/lib/server/sightings";

/** GET — today's taps (the owner's timeline), oldest first. */
export async function GET(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!dbConfigured()) return noDb();
  return json({ events: await todaysEvents(auth.user.id) });
}

/** POST — owner one-tap log. `at` = the tap, or a time picked up to 12 h back. */
export async function POST(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!dbConfigured()) return noDb();
  const parsed = tripEventInput.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad event" }, 400);
  if (!sightingTimeOk(Date.parse(parsed.data.at), Date.now())) return json({ error: "Times can be at most 12 hours back." }, 400);
  return json(await logTripEvent(auth.user.id, parsed.data), 201);
}

/** PATCH — timeline edit `{ id, at?, station?, direction? }`; the linked train sighting follows. */
export async function PATCH(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!dbConfigured()) return noDb();
  const parsed = tripEventPatch.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "Bad edit" }, 400);
  if (parsed.data.at && !sightingTimeOk(Date.parse(parsed.data.at), Date.now())) return json({ error: "Times can be at most 12 hours back." }, 400);
  const result = await updateTripEvent(auth.user.id, parsed.data);
  return result.ok ? json(result) : json({ error: "Not found" }, 404);
}

/** DELETE ?clientId= — undo within 10 s; ?id= — delete from the timeline. */
export async function DELETE(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  if (!dbConfigured()) return noDb();
  const params = new URL(request.url).searchParams;
  const id = Number(params.get("id"));
  if (params.has("id")) {
    if (!Number.isInteger(id) || id <= 0) return json({ error: "Bad id" }, 400);
    const result = await deleteTripEvent(auth.user.id, id);
    return result.deleted ? json(result) : json({ error: "Not found" }, 404);
  }
  const clientId = params.get("clientId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json({ error: "Bad id" }, 400);
  return json(await undoTripEvent(auth.user.id, clientId));
}
