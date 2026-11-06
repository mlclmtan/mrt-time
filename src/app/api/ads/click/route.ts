import { dbConfigured } from "@/lib/db";
import { clickDestination, logAdEvent } from "@/lib/server/ads";
import { isAdPlacement } from "@/lib/ads/formats";
import { userTypeFor } from "@/lib/server/visitor";
import { appUrl } from "@/lib/seo";

const SESSION = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * GET /api/ads/click?c=<creative>&p=<placement>[&s=<session>] — logs the
 * click, then 302s to the creative's destination with UTM appended. The
 * destination only ever comes from the database (no open redirect).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const creativeId = Number(url.searchParams.get("c"));
  const placement = url.searchParams.get("p");
  const sid = url.searchParams.get("s");
  const home = new URL("/", appUrl()).toString();
  if (!Number.isInteger(creativeId) || creativeId <= 0 || !isAdPlacement(placement) || !dbConfigured()) return Response.redirect(home, 302);
  const internal = (await userTypeFor(request)) !== "visitor";
  const cr = await logAdEvent({ type: "click", creativeId, placement, sessionId: sid && SESSION.test(sid) ? sid : null, deviceId: null, internal }).catch(() => null);
  const to = cr ? clickDestination(cr, appUrl()) : null;
  return new Response(null, { status: 302, headers: { location: to ?? home, "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" } });
}
