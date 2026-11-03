import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { dbConfigured, getDb } from "@/lib/db";
import { feedback, npsResponse } from "@/lib/db/schema";
import { feedbackSummaryQuery, runRows } from "@/lib/analytics/aggregates";
import { parseRange } from "@/lib/server/admin";
import { Card, DataTable, StatCard } from "@/components/admin/charts";

/** Free text is owner-only (never exported to analysts or third parties). */
export default async function FeedbackAdmin() {
  const session = await getSession();
  if (session?.user.role !== "owner") redirect("/admin");
  const { t } = await getT();
  if (!dbConfigured()) return <p className="text-muted">{t("common.notConfigured")}</p>;
  const db = getDb();
  const range = parseRange(null, null);
  const [items, nps, summary] = await Promise.all([
    db.select().from(feedback).orderBy(desc(feedback.ts)).limit(100),
    db.select().from(npsResponse).orderBy(desc(npsResponse.ts)).limit(100),
    runRows<{ feedback_count: number; avg_rating: number | null; nps_count: number; nps: number | null }>(db, feedbackSummaryQuery(range)).catch(() => []),
  ]);
  const s = summary[0];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("admin.feedback")} value={s?.feedback_count ?? 0} />
        <StatCard label={t("admin.feedback.avg")} value={s?.avg_rating ?? "—"} />
        <StatCard label="NPS n" value={s?.nps_count ?? 0} />
        <StatCard label={t("admin.feedback.nps")} value={s?.nps ?? "—"} />
      </div>
      <Card title={t("admin.feedback")} csv="/api/admin/export?table=feedback">
        <DataTable rows={items.map((f) => ({ at: f.ts, rating: f.rating, category: f.category, text: f.text, route: f.route, lang: f.language }))} />
      </Card>
      <Card title="NPS" csv="/api/admin/export?table=nps_response">
        <DataTable rows={nps.map((n) => ({ at: n.ts, score: n.score, comment: n.comment }))} />
      </Card>
    </div>
  );
}
