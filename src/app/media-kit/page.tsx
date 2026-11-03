import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { dbConfigured, getDb } from "@/lib/db";
import { mediaKitQuery, runRows, topQuery } from "@/lib/analytics/aggregates";
import { getStation } from "@/lib/network";
import { DAY, nowMs } from "@/lib/time";
import { localePath } from "@/lib/i18n";
import { ShareButton } from "@/components/share-button";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/media-kit", title: t("media.title"), description: t("media.intro") });
}

/** Public live aggregate stats for pitching creators (no personal data). */
export default async function MediaKitPage() {
  const { locale, t } = await getT();
  const now = nowMs();
  let stats = { users: 0, sessions: 0, page_views: 0 };
  let top: { key: string; n: number }[] = [];
  if (dbConfigured()) {
    const db = getDb();
    [stats] = (await runRows<typeof stats>(db, mediaKitQuery(new Date(now))).catch(() => [stats])) as [typeof stats];
    top = await runRows<{ key: string; n: number }>(db, topQuery({ from: new Date(now - 30 * DAY), to: new Date(now) }, "station", 5)).catch(() => []);
  }
  const cards: [string, number][] = [
    [t("media.users"), stats?.users ?? 0],
    [t("media.sessions"), stats?.sessions ?? 0],
    [t("media.pageViews"), stats?.page_views ?? 0],
  ];
  return (
    <div className="space-y-6 pt-6">
      <h1 className="text-3xl font-bold">{t("media.title")}</h1>
      <p className="max-w-2xl text-muted">{t("media.intro")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(([label, value]) => (
          <div key={label} className="panel p-4">
            <div className="text-sm text-muted">{label}</div>
            <div className="led text-4xl font-bold">{value.toLocaleString("en-SG")}</div>
          </div>
        ))}
      </div>
      <section className="panel p-4">
        <h2 className="font-semibold">{t("media.topStations")}</h2>
        {top.length ? (
          <ol className="mt-2 list-decimal pl-5 text-sm">
            {top.map((r) => (
              <li key={r.key}>{getStation(r.key)?.name[locale] ?? r.key}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("common.none")}</p>
        )}
      </section>
      <p className="text-sm text-muted">{t("media.contact")}</p>
      <ShareButton path={localePath(locale, "/media-kit")} title={t("media.title")} contentType="media_kit" />
    </div>
  );
}
