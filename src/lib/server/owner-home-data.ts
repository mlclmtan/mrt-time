import { cookies } from "next/headers";
import { ownerJourneys, commuteFor } from "@/lib/server/journeys";
import { todaysEvents } from "@/lib/server/trips";
import { schedulingAvailable } from "@/lib/push/config";
import {
  JOURNEY_CHOICE_COOKIE,
  TRIP_DISMISSED_COOKIE,
  autoJourneyKey,
  parseDismissed,
  parseJourneyChoice,
  resolveTrip,
} from "@/lib/journey/commute";
import { dbConfigured } from "@/lib/db";
import { STATIONS } from "@/lib/network/data";
import { nowMs, sgtClock } from "@/lib/time";
import type { Locale } from "@/lib/i18n";
import type { ComponentProps } from "react";
import type { OwnerHome } from "@/components/owner/owner-home";

export type OwnerHomeData = ComponentProps<typeof OwnerHome>;

export async function loadOwnerHomeData(userId: string, locale: Locale): Promise<OwnerHomeData> {
  const now = nowMs();
  const [journeys, today, jar] = await Promise.all([
    ownerJourneys(userId),
    dbConfigured() ? todaysEvents(userId, now).catch(() => []) : Promise.resolve([]),
    cookies(),
  ]);
  // Before 14:00 → Home→Office, after → Office→Home; a manual pick holds for 2 h.
  const choice = parseJourneyChoice(jar.get(JOURNEY_CHOICE_COOKIE)?.value);
  const key = autoJourneyKey(journeys, now, choice);
  const journey = journeys.find((j) => j.key === key);
  const taps = today.filter((e) => !e.journeyKey || e.journeyKey === key);
  // The same resolver as the Home button (finished trips, Dismiss, new trips).
  const dismissedAt = parseDismissed(jar.get(TRIP_DISMISSED_COOKIE)?.value);
  const initialView = journey
    ? await commuteFor(journey, resolveTrip(journey, taps, now, { dismissedAt }).progress, now).catch(() => null)
    : null;

  return {
    journeys,
    initialKey: key,
    initialChoice: choice,
    initialView,
    initialDismissedAt: dismissedAt,
    today,
    stations: STATIONS.map((s) => ({ slug: s.slug, name: s.name[locale] })),
    remindersAvailable: schedulingAvailable(),
    defaultTime: sgtClock(now),
  };
}
