import { dbConfigured, getDb } from "@/lib/db";
import { EXPORTS, exportQuery, runRows, toCsv, type ExportName } from "@/lib/analytics/aggregates";
import { json, noDb, requireRole } from "@/lib/server/http";
import { parseRange } from "@/lib/server/admin";

/** GET /api/admin/export?table=event_log&from=YYYY-MM-DD&to=YYYY-MM-DD → CSV. */
export async function GET(request: Request) {
  const auth = await requireRole(request, ["owner", "analyst"]);
  if ("response" in auth) return auth.response;
  if (!dbConfigured()) return noDb();
  const url = new URL(request.url);
  const table = url.searchParams.get("table") || "";
  if (!(table in EXPORTS)) return json({ error: "Unknown table" }, 400);
  // Analysts never see free-text feedback.
  if (auth.user.role === "analyst" && (table === "feedback" || table === "nps_response")) return json({ error: "Not allowed" }, 403);
  const range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"));
  const rows = await runRows<Record<string, unknown>>(getDb(), exportQuery(table as ExportName, range));
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${table}-${url.searchParams.get("from") || "range"}.csv"`,
      "cache-control": "no-store",
    },
  });
}
