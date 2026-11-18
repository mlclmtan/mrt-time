import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";
import { loadOwnerHomeData } from "@/lib/server/owner-home-data";
import { OwnerHome } from "@/components/owner/owner-home";

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
    <div className="pt-6">
      <OwnerHome {...data} />
    </div>
  );
}
