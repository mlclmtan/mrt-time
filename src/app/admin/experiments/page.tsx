import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { dbConfigured, getDb } from "@/lib/db";
import { experiment } from "@/lib/db/schema";
import { experimentResultsQuery, runRows } from "@/lib/analytics/aggregates";
import { DEFAULT_EXPERIMENTS, significance, type Variant } from "@/lib/analytics/experiments";
import { parseRange } from "@/lib/server/admin";
import { Card, DataTable } from "@/components/admin/charts";
import { RangeForm } from "@/components/admin/range-form";
import { saveExperiment } from "../actions";

type Result = { variant: string; exposed: number; planner: number; installs: number; newsletter: number };

export default async function Experiments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, { t }] = await Promise.all([getSession(), getT()]);
  if (!dbConfigured()) return <p className="text-muted">{t("common.notConfigured")}</p>;
  const sp = await searchParams;
  const range = parseRange(sp.from as string | undefined, sp.to as string | undefined);
  const db = getDb();
  const stored = await db.select().from(experiment).orderBy(desc(experiment.createdAt));
  const list = stored.length
    ? stored.map((e) => ({ key: e.key, name: e.name, active: e.active, variants: e.variants as Variant[] }))
    : DEFAULT_EXPERIMENTS.map((e) => ({ ...e, name: e.key }));
  const results = await Promise.all(list.map((e) => runRows<Result>(db, experimentResultsQuery(range, e.key)).catch(() => [] as Result[])));
  const owner = session?.user.role === "owner";
  return (
    <div className="space-y-4">
      {owner && (
        <form action={saveExperiment} className="panel grid gap-2 p-4 sm:grid-cols-4">
          <label className="text-xs text-muted">
            {t("admin.exp.key")}
            <input name="key" required className="field mt-1 text-sm" defaultValue="landing_hero" />
          </label>
          <label className="text-xs text-muted">
            {t("admin.exp.name")}
            <input name="name" className="field mt-1 text-sm" />
          </label>
          <label className="text-xs text-muted sm:col-span-2">
            {t("admin.exp.variants")}
            <input name="variants" required className="field mt-1 text-sm" defaultValue="control:50, countdown:50" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked /> {t("admin.exp.active")}
          </label>
          <button className="btn btn-primary sm:col-span-3">{t("common.save")}</button>
        </form>
      )}
      <RangeForm t={t} from={range.fromDate} to={range.toDate} />
      {list.map((e, i) => {
        const rows = results[i];
        const control = rows.find((r) => r.variant === e.variants[0]?.key) ?? rows[0];
        return (
          <Card key={e.key} title={`${e.name} (${e.key}) ${e.active ? "" : "· paused"}`}>
            <DataTable
              rows={rows.map((r) => {
                const sig = control && r !== control ? significance({ n: control.exposed, x: control.planner }, { n: r.exposed, x: r.planner }) : null;
                return {
                  variant: r.variant,
                  [t("admin.exp.exposed")]: r.exposed,
                  [t("admin.exp.planner")]: `${r.planner} (${r.exposed ? Math.round((100 * r.planner) / r.exposed) : 0}%)`,
                  [t("admin.exp.installs")]: r.installs,
                  [t("admin.exp.newsletter")]: r.newsletter,
                  significance: sig ? sig.note : "baseline",
                };
              })}
            />
          </Card>
        );
      })}
    </div>
  );
}
