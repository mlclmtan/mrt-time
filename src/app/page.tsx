import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/server";
import { pageMetadata, websiteJsonLd } from "@/lib/seo";
import { experimentAssignments } from "@/lib/server/experiments";
import { commuteFor, ownerJourneys } from "@/lib/server/journeys";
import { todaysEvents } from "@/lib/server/trips";
import { schedulingAvailable } from "@/lib/push/config";
import { JOURNEY_CHOICE_COOKIE, TRIP_DISMISSED_COOKIE, autoJourneyKey, parseDismissed, parseJourneyChoice, resolveTrip } from "@/lib/journey/commute";
import { dbConfigured } from "@/lib/db";
import { STATIONS } from "@/lib/network/data";
import { nowMs, sgtClock } from "@/lib/time";
import { Landing } from "@/components/landing";
import { JsonLd } from "@/components/json-ld";
import { OwnerHome } from "@/components/owner/owner-home";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/", title: `${t("app.name")} — ${t("app.tagline")}`, description: t("hero.sub"), image: "/opengraph-image" });
}

export default async function Home() {
  const [{ locale, t }, session] = await Promise.all([getT(), getSession()]);
  if (session?.user.role === "owner") {
    const now = nowMs();
    const [journeys, today, jar] = await Promise.all([
      ownerJourneys(session.user.id),
      dbConfigured() ? todaysEvents(session.user.id, now).catch(() => []) : Promise.resolve([]),
      cookies(),
    ]);
    // Before 14:00 → Home→Office, after → Office→Home; a manual pick holds for 2 h.
    const choice = parseJourneyChoice(jar.get(JOURNEY_CHOICE_COOKIE)?.value);
    const key = autoJourneyKey(journeys, now, choice);
    const journey = journeys.find((j) => j.key === key);
    const taps = today.filter((e) => !e.journeyKey || e.journeyKey === key);
    // The same resolver as the Home button (finished trips, Dismiss, new trips).
    const dismissedAt = parseDismissed(jar.get(TRIP_DISMISSED_COOKIE)?.value);
    const initialView = journey ? await commuteFor(journey, resolveTrip(journey, taps, now, { dismissedAt }).progress, now).catch(() => null) : null;
    return (
      <div className="pt-6">
        <OwnerHome
          journeys={journeys}
          initialKey={key}
          initialChoice={choice}
          initialView={initialView}
          initialDismissedAt={dismissedAt}
          today={today}
          stations={STATIONS.map((s) => ({ slug: s.slug, name: s.name[locale] }))}
          remindersAvailable={schedulingAvailable()}
          defaultTime={sgtClock(now)}
        />
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
