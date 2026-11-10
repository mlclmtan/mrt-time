import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { groupBacktest, sightingAccuracy, type AccuracyGroup } from "@/lib/server/accuracy";
import { LINES, isLineCode, stationForCode } from "@/lib/network";
import type { DictKey } from "@/lib/i18n";

export const revalidate = 600;

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/accuracy", title: t("accuracy.title"), description: t("accuracy.intro") });
}

export default async function AccuracyPage() {
  const { t, locale } = await getT();
  const rows = await sightingAccuracy().catch(() => []);
  const label = (by: "line" | "band" | "station", key: string) => {
    if (by === "line") return isLineCode(key) ? LINES[key].name[locale] : key;
    if (by === "band") return t(`acc.band.${key}` as DictKey);
    return `${stationForCode(key)?.name[locale] ?? key} · ${key}`;
  };
  const groups: [DictKey, "line" | "band" | "station", AccuracyGroup[]][] = [
    ["accuracy.byLine", "line", groupBacktest(rows, "line")],
    ["accuracy.byBand", "band", groupBacktest(rows, "band")],
    ["accuracy.byStation", "station", groupBacktest(rows, "station")],
  ];
  return (
    <div className="space-y-6 pt-6">
      <h1 className="text-3xl font-bold">{t("accuracy.title")}</h1>
      <p className="max-w-2xl text-muted">{t("acc.intro")}</p>
      <p className="text-sm text-muted">{t("acc.total", { n: rows.length })}</p>
      {groups.map(([title, by, list]) => (
        <section key={title} className="panel p-4">
          <h2 className="font-semibold">{t(title)}</h2>
          {list.filter((r) => r.scored > 0).length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t("acc.none")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {list
                .filter((r) => r.scored > 0)
                .map((r) => {
                  const pct = Math.round((100 * r.hits) / r.scored);
                  return (
                    <li key={r.key} className="text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>{label(by, r.key)}</span>
                        <span className="tabular text-muted">
                          {pct}% · {t("accuracy.hits", { hits: r.hits, scored: r.scored })}
                          {r.medianErrorMin != null && ` · ${t("acc.off", { n: r.medianErrorMin })}`}
                          {r.ranges > 0 && ` · ${t("acc.ranges", { n: r.ranges })}`}
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
