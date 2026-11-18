import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/server";
import { pageMetadata, websiteJsonLd } from "@/lib/seo";
import { experimentAssignments } from "@/lib/server/experiments";
import { Landing } from "@/components/landing";
import { JsonLd } from "@/components/json-ld";
import { OwnerHome } from "@/components/owner/owner-home";
import { loadOwnerHomeData } from "@/lib/server/owner-home-data";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/", title: `${t("app.name")} — ${t("app.tagline")}`, description: t("hero.sub"), image: "/opengraph-image" });
}

export default async function Home() {
  const [{ locale, t }, session] = await Promise.all([getT(), getSession()]);
  if (session?.user.role === "owner") {
    const data = await loadOwnerHomeData(session.user.id, locale);
    return (
      <div className="pt-6">
        <OwnerHome {...data} />
      </div>
    );
  }
  const experiments = await experimentAssignments();
  return (
    <>
      <JsonLd data={websiteJsonLd(locale)} />
      <Landing locale={locale} t={t} variant={experiments.landing_hero ?? "control"} />
    </>
  );
}
