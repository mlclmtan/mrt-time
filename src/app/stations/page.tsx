import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { STATIONS } from "@/lib/network";
import { ClientStations } from "@/components/client-stations";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/stations", title: t("stations.title"), description: t("stations.intro", { n: STATIONS.length }) });
}

export default async function StationsPage() {
  const { t } = await getT();
  return (
    <div className="space-y-3 pt-3">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("stations.title")}</h1>
      <p className="hidden text-sm text-muted sm:block">{t("stations.intro", { n: STATIONS.length })}</p>
      <ClientStations />
    </div>
  );
}
