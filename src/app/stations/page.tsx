import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { STATIONS } from "@/lib/network";
import { StationsList } from "@/components/stations-list";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/stations", title: t("stations.title"), description: t("stations.intro", { n: STATIONS.length }) });
}

export default async function StationsPage() {
  const { t } = await getT();
  return (
    <div className="space-y-4 pt-6">
      <h1 className="text-3xl font-bold">{t("stations.title")}</h1>
      <p className="text-muted">{t("stations.intro", { n: STATIONS.length })}</p>
      <StationsList />
    </div>
  );
}
