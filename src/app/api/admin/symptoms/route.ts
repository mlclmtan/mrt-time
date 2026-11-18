import { dbConfigured, getDb } from "@/lib/db";
import { bearerMatches, json, noDb, requireRole } from "@/lib/server/http";
import { getSymptomsReport } from "@/lib/analytics/symptoms";
import type { Range } from "@/lib/analytics/aggregates";

export function parseSince(sinceStr: string | null | undefined, now = Date.now()): Range {
  const s = sinceStr?.trim() || "7d";
  const match = s.match(/^(\d+)([dhw])$/);
  let ms = 7 * 24 * 3600 * 1000;
  if (match) {
    const n = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === "h") ms = n * 3600 * 1000;
    else if (unit === "d") ms = n * 24 * 3600 * 1000;
    else if (unit === "w") ms = n * 7 * 24 * 3600 * 1000;
  }
  return {
    from: new Date(now - ms),
    to: new Date(now),
  };
}

/**
 * GET /api/admin/symptoms?since=7d
 * JSON { window, findings[], counts }
 * Auth: owner/analyst session OR Authorization: Bearer <INGEST_TOKEN>
 */
export async function GET(request: Request) {
  const hasBearer = Boolean(
    process.env.INGEST_TOKEN && bearerMatches(request, process.env.INGEST_TOKEN),
  );

  let authorized = hasBearer;
  if (!authorized) {
    const auth = await requireRole(request, ["owner", "analyst"]);
    if (!("response" in auth)) {
      authorized = true;
    }
  }

  if (!authorized) {
    return json({ error: "Unauthorized" }, 401, { "Cache-Control": "no-store" });
  }

  if (!dbConfigured()) return noDb();

  const url = new URL(request.url);
  const range = parseSince(url.searchParams.get("since"));
  const report = await getSymptomsReport(getDb(), range);

  return json(report, 200, { "Cache-Control": "no-store" });
}
