import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { dbConfigured, getDb } from "@/lib/db";
import { accuracyQuery, runRows } from "@/lib/analytics/aggregates";
import { DAY } from "@/lib/time";
import type { DictKey } from "@/lib/i18n";

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/accuracy", title: t("accuracy.title"), description: t("accuracy.intro") });
}

type Row = { key: string; scored: number; hits: number };

async function load(by: "line" | "station" | "band"): Promise<Row[]> {
  if (!dbConfigured()) return [];
  const now = Date.now();
  return runRows<Row>(getDb(), accuracyQuery({ from: new Date(now - 365 * DAY), to: new Date(now + DAY) }, by)).catch(() => []);
}

export default async function AccuracyPage() {
  const { t } = await getT();
  const [byLine, byStation, byBand] = await Promise.all([load("line"), load("station"), load("band")]);
  const groups: [DictKey, Row[]][] = [
    ["accuracy.byLine", byLine],
    ["accuracy.byStation", byStation],
    ["accuracy.byBand", byBand],
  ];
  return (
    <div className="space-y-6 pt-6">
      <h1 className="text-3xl font-bold">{t("accuracy.title")}</h1>
      <p className="max-w-2xl text-muted">{t("accuracy.intro")}</p>
      {groups.map(([title, rows]) => (
        <section key={title} className="panel p-4">
          <h2 className="font-semibold">{t(title)}</h2>
          {rows.filter((r) => r.scored > 0).length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t("accuracy.none")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {rows
                .filter((r) => r.scored > 0)
                .map((r) => {
                  const pct = Math.round((100 * r.hits) / r.scored);
                  return (
                    <li key={r.key} className="text-sm">
                      <div className="flex justify-between">
                        <span>{r.key}</span>
                        <span className="tabular text-muted">
                          {pct}% · {t("accuracy.hits", { hits: r.hits, scored: r.scored })}
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-panel-2">
                        <div className="h-full rounded-full bg-led" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
