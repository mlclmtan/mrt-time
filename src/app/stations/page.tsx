import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { STATIONS } from "@/lib/network";
import { ClientStations } from "@/components/client-stations";
import { localePath } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/stations", title: t("stations.title"), description: t("stations.intro", { n: STATIONS.length }) });
}

export default async function StationsPage() {
  const { t, locale } = await getT();
  return (
    <div className="space-y-3 pt-3">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("stations.title")}</h1>
      <p className="hidden text-sm text-muted sm:block">{t("stations.intro", { n: STATIONS.length })}</p>
      <ClientStations />
      {/* Plain links for crawlers and no-JS: the interactive list above renders on the client only. */}
      <noscript>
        <nav aria-label={t("stations.allLinks")}>
          <ul>
            {STATIONS.map((s) => (
              <li key={s.slug}>
                <a href={localePath(locale, `/station/${s.slug}`)}>{s.name[locale]}</a>
              </li>
            ))}
          </ul>
        </nav>
      </noscript>
    </div>
  );
}
