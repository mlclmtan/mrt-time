import { dbConfigured, getDb } from "@/lib/db";
import { toCsv } from "@/lib/analytics/aggregates";
import { adReport, AD_REPORT_DIMENSIONS, type AdReportDimension } from "@/lib/server/ads";
import { json, noDb, requireRole } from "@/lib/server/http";
import { parseRange } from "@/lib/server/admin";

/** GET /api/admin/ads-report?by=campaign|creative|format|placement&from&to → CSV. */
export async function GET(request: Request) {
  const auth = await requireRole(request, ["owner", "analyst"]);
  if ("response" in auth) return auth.response;
  if (!dbConfigured()) return noDb();
  const url = new URL(request.url);
  const by = url.searchParams.get("by") as AdReportDimension;
  if (!AD_REPORT_DIMENSIONS.includes(by)) return json({ error: "Unknown dimension" }, 400);
  const range = parseRange(url.searchParams.get("from"), url.searchParams.get("to"));
  const rows = await adReport(getDb(), range, by);
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ads-by-${by}-${range.fromDate}-${range.toDate}.csv"`,
      "cache-control": "no-store",
    },
  });
}
