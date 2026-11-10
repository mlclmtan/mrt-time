import { json } from "@/lib/server/http";
import { timed } from "@/lib/server/metrics";
import { getSession } from "@/lib/auth/server";
import { commuteFor, ownerJourneys } from "@/lib/server/journeys";
import { PROGRESS_STALE_MS, type CommuteProgress, type CommuteState } from "@/lib/journey/commute";
import { HOUR } from "@/lib/time";

const STATES: CommuteState[] = ["idle", "at_platform", "on_board", "between"];

/**
 * GET /api/commute?journey=home_to_office[&fromLeg=2&state=on_board&startAt=<ms>]
 * Owner only. The client works out where the owner is along the journey
 * from its taps (instantly, before the POST lands) and passes it here.
 * `startAt` comes from the tap times (end of the current ride, or when you
 * got off) and may be in the past: the rest of the trip is planned from
 * it, never from now; the server says "finished" once now is past the
 * expected arrival + 15 min.
 */
export const GET = timed("/api/commute", async (request) => {
  const session = await getSession();
  if (session?.user.role !== "owner") return json({ error: "Please sign in." }, 401);
  const p = new URL(request.url).searchParams;
  const journey = (await ownerJourneys(session.user.id)).find((j) => j.key === p.get("journey"));
  if (!journey) return json({ error: "Unknown journey" }, 404);
  const now = Date.now();
  const fromLeg = Math.max(0, Math.min(journey.legs.length, Math.round(Number(p.get("fromLeg")) || 0)));
  const state = STATES.find((s) => s === p.get("state")) ?? "idle";
  const startRaw = Number(p.get("startAt"));
  // Tap-based starts: from a little over the stale limit back (+ a long ride) to 2 h ahead.
  const startOk = Number.isFinite(startRaw) && startRaw > now - PROGRESS_STALE_MS - 2 * HOUR && startRaw < now + 2 * HOUR;
  const startAt = state !== "idle" && startOk ? startRaw : now;
  const progress: CommuteProgress = { state, fromLeg, startAt };
  return json(await commuteFor(journey, progress, now));
});
