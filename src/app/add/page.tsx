import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { getSession } from "@/lib/auth/server";
import { pageMetadata } from "@/lib/seo";
import { dbConfigured } from "@/lib/db";
import { ownerJourneys } from "@/lib/server/journeys";
import { todaysEvents } from "@/lib/server/trips";
import { autoJourneyKey } from "@/lib/journey/commute";
import { journeySteps, nextStepIndex } from "@/lib/journey/steps";
import { nowMs } from "@/lib/time";
import { AddReading } from "@/components/add-reading";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/add", title: t("reading.title"), description: t("reading.intro") });
}

/** For the owner: the platform of the next journey step (the station nearest in sequence). */
async function ownerDefault(userId: string): Promise<{ station: string; direction: string } | null> {
  if (!dbConfigured()) return null;
  const now = nowMs();
  const [journeys, today] = await Promise.all([ownerJourneys(userId).catch(() => []), todaysEvents(userId, now).catch(() => [])]);
  const key = autoJourneyKey(journeys, now, null);
  const journey = journeys.find((j) => j.key === key);
  if (!journey) return null;
  const steps = journeySteps(journey.legs);
  const mine = today.filter((e) => !e.journeyKey || e.journeyKey === key);
  const next = steps.slice(nextStepIndex(steps, mine)).find((s) => (s.kind === "at_platform" || s.kind === "board") && s.station && s.direction);
  return next?.station && next.direction ? { station: next.station, direction: next.direction } : null;
}

export default async function AddPage() {
  const [{ t }, session] = await Promise.all([getT(), getSession()]);
  const preset = session?.user.role === "owner" ? await ownerDefault(session.user.id) : null;
  return (
    <div className="mx-auto max-w-md space-y-4 pt-4">
      <h1 className="text-2xl font-bold">{t("reading.title")}</h1>
      <p className="text-sm text-muted">{t("add.intro")}</p>
      <AddReading defaultStation={preset?.station} defaultDirection={preset?.direction} />
    </div>
  );
}
