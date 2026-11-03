import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { dbConfigured, getDb } from "@/lib/db";
import { kol } from "@/lib/db/schema";
import { kolFunnelQuery, runRows } from "@/lib/analytics/aggregates";
import { parseRange } from "@/lib/server/admin";
import { appUrl } from "@/lib/seo";
import { Card, DataTable } from "@/components/admin/charts";
import { RangeForm } from "@/components/admin/range-form";
import { saveKol, toggleKol } from "../actions";

export default async function Kols({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, { t }] = await Promise.all([getSession(), getT()]);
  if (!dbConfigured()) return <p className="text-muted">{t("common.notConfigured")}</p>;
  const sp = await searchParams;
  const range = parseRange(sp.from as string | undefined, sp.to as string | undefined);
  const db = getDb();
  const [creators, funnel] = await Promise.all([
    db.select().from(kol).orderBy(desc(kol.createdAt)),
    runRows<{ handle: string; visits: number; planner: number; installs: number; active_7d: number }>(db, kolFunnelQuery(range)).catch(() => []),
  ]);
  const owner = session?.user.role === "owner";
  const base = appUrl();
  return (
    <div className="space-y-4">
      {owner && (
        <form action={saveKol} className="panel grid gap-2 p-4 sm:grid-cols-3">
          <label className="text-xs text-muted">
            {t("admin.kol.handle")}
            <input name="handle" required pattern="[a-z0-9_-]{2,40}" className="field mt-1 text-sm" />
          </label>
          <label className="text-xs text-muted">
            {t("admin.kol.name")}
            <input name="displayName" required className="field mt-1 text-sm" />
          </label>
          <label className="text-xs text-muted">
            {t("admin.kol.platform")}
            <select name="platform" className="field mt-1 text-sm">
              {["instagram", "tiktok", "youtube", "xhs", "threads", "other"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            {t("admin.kol.code")}
            <input name="code" required pattern="[A-Za-z0-9_-]{2,20}" className="field mt-1 text-sm uppercase" />
          </label>
          <label className="text-xs text-muted">
            {t("admin.kol.variant")}
            <select name="landingVariant" className="field mt-1 text-sm">
              <option value="default">default</option>
              <option value="planner">planner</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            {t("admin.kol.notes")}
            <input name="notes" className="field mt-1 text-sm" />
          </label>
          <button className="btn btn-primary sm:col-span-3">{t("common.save")}</button>
        </form>
      )}
      <Card title={t("admin.kols")}>
        <DataTable
          rows={creators.map((c) => ({
            handle: c.handle,
            name: c.displayName,
            platform: c.platform,
            code: c.code,
            variant: c.landingVariant,
            link: `${base}/k/${c.handle}`,
            referral: `${base}/r/${c.code}`,
            active: c.active ? "yes" : "no",
          }))}
        />
        {owner && (
          <div className="mt-2 flex flex-wrap gap-2">
            {creators.map((c) => (
              <form key={c.id} action={toggleKol}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="active" value={c.active ? "0" : "1"} />
                <button className="rounded-full border border-line px-2 py-0.5 text-xs">
                  {c.handle}: {c.active ? "pause" : "activate"}
                </button>
              </form>
            ))}
          </div>
        )}
      </Card>
      <RangeForm t={t} from={range.fromDate} to={range.toDate} />
      <Card title={t("admin.kol.funnel")}>
        <DataTable rows={funnel} />
      </Card>
    </div>
  );
}
