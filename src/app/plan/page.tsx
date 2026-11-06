import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/server";
import { pageMetadata } from "@/lib/seo";
import { STATIONS } from "@/lib/network/data";
import { getStation } from "@/lib/network";
import { ownerJourneys } from "@/lib/server/journeys";
import { schedulingAvailable } from "@/lib/push/config";
import { JOURNEY_CHOICE_COOKIE, autoJourneyKey, journeyEnds, parseJourneyChoice } from "@/lib/journey/commute";
import { nowMs, sgtClock } from "@/lib/time";
import { Planner } from "@/components/plan/planner";
import { AdSlot } from "@/components/ads/ad-slot";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/plan", title: t("plan.title"), description: t("landing.planner"), image: "/opengraph-image" });
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ locale, t }, session, q] = await Promise.all([getT(), getSession(), searchParams]);
  const now = nowMs();
  // The owner starts from their current journey's stations and walks.
  const owner = session?.user.role === "owner";
  const journeys = owner && session ? await ownerJourneys(session.user.id).catch(() => []) : [];
  const choice = owner ? parseJourneyChoice((await cookies()).get(JOURNEY_CHOICE_COOKIE)?.value) : null;
  const current = journeys.find((j) => j.key === autoJourneyKey(journeys, now, choice));
  const ends = current ? journeyEnds(current.legs) : null;
  const pick = (v: unknown, fallback: string) => (typeof v === "string" && getStation(v) ? v : fallback);
  const explicit = typeof q.from === "string" || typeof q.to === "string";
  return (
    <div className="space-y-4 pt-6">
      <h1 className="text-3xl font-bold">{t("plan.title")}</h1>
      <Planner
        stations={STATIONS.map((s) => ({ slug: s.slug, name: s.name[locale] }))}
        journeys={journeys.map((j) => ({ key: j.key, name: j.name, sheltered: j.sheltered }))}
        defaultJourney=""
        defaultFrom={pick(q.from, ends?.from ?? "tiong-bahru")}
        defaultTo={pick(q.to, ends?.to ?? "shenton-way")}
        defaultWalkFrom={explicit ? 0 : (ends?.walkFrom ?? 0)}
        defaultWalkTo={explicit ? 0 : (ends?.walkTo ?? 0)}
        defaultTime={sgtClock(now)}
        remindersAvailable={owner && schedulingAvailable()}
      />
      <AdSlot placement="planner" />
    </div>
  );
}
