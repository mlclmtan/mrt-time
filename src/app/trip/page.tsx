import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";
import { loadOwnerHomeData } from "@/lib/server/owner-home-data";
import { TripScreen } from "@/components/trip/trip-screen";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function TripPage() {
  const [{ locale }, session] = await Promise.all([getT(), getSession()]);
  if (session?.user.role !== "owner") {
    redirect(localePath(locale, "/stations"));
  }
  const data = await loadOwnerHomeData(session.user.id, locale);
  return (
    <TripScreen
      journeys={data.journeys}
      initialKey={data.initialKey}
      initialChoice={data.initialChoice}
      initialView={data.initialView}
      initialDismissedAt={data.initialDismissedAt}
      today={data.today}
    />
  );
}
