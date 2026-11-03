import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/server";
import { pageMetadata, websiteJsonLd } from "@/lib/seo";
import { experimentAssignments } from "@/lib/server/experiments";
import { ownerJourneys } from "@/lib/server/journeys";
import { todaysEvents } from "@/lib/server/trips";
import { schedulingAvailable } from "@/lib/push/config";
import { suggestedJourney } from "@/lib/journey/steps";
import { dbConfigured } from "@/lib/db";
import { STATIONS } from "@/lib/network/data";
import { nowMs, sgtMinuteOfDay } from "@/lib/time";
import { Landing } from "@/components/landing";
import { JsonLd } from "@/components/json-ld";
import { OwnerHome } from "@/components/owner/owner-home";
import { VersionTag } from "@/components/update-banner";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/", title: `${t("app.name")} — ${t("app.tagline")}`, description: t("hero.sub"), image: "/opengraph-image" });
}

export default async function Home() {
  const [{ locale, t }, session] = await Promise.all([getT(), getSession()]);
  if (session?.user.role === "owner") {
    const now = nowMs();
    const [journeys, today] = await Promise.all([
      ownerJourneys(session.user.id),
      dbConfigured() ? todaysEvents(session.user.id, now).catch(() => []) : Promise.resolve([]),
    ]);
    return (
      <div className="pt-6">
        <OwnerHome
          journeys={journeys}
          initialKey={suggestedJourney(journeys, Math.floor(sgtMinuteOfDay(now) / 60))?.key}
          today={today}
          stations={STATIONS.map((s) => ({ slug: s.slug, name: s.name[locale] }))}
          remindersAvailable={schedulingAvailable()}
        />
        <VersionTag className="mt-6 block" />
      </div>
    );
  }
  const experiments = await experimentAssignments();
  return (
    <>
      <JsonLd data={websiteJsonLd(locale)} />
      <Landing locale={locale} t={t} variant={experiments.landing_hero ?? "control"} />
      <VersionTag className="mt-8 block" />
    </>
  );
}
