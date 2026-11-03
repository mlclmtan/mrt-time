import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";
import { dbConfigured, getDb } from "@/lib/db";
import { kol } from "@/lib/db/schema";
import { kolUtm } from "@/lib/analytics/utm";
import { StationGrid } from "@/components/landing";
import { KolTracker } from "@/components/trackers";

export const metadata: Metadata = { robots: { index: false, follow: true } };

async function findKol(handle: string) {
  if (!dbConfigured() || !/^[a-z0-9_-]{1,48}$/.test(handle)) return null;
  return getDb().query.kol.findFirst({ where: eq(kol.handle, handle) }).catch(() => null);
}

/** Co-branded KOL landing. UTM (source=handle, medium=kol) is applied by redirecting once. */
export default async function KolLanding({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { handle: raw } = await params;
  const handle = raw.toLowerCase();
  const q = await searchParams;
  const creator = await findKol(handle);
  if (!creator || !creator.active) notFound();
  const { locale, t } = await getT();
  const utm = kolUtm(handle, `kol-${handle}`);
  const hasUtm = typeof q.utm_source === "string";
  return (
    <div className="space-y-8 pt-6">
      <KolTracker handle={handle} codeUsed={q.code === "1"} />
      {!hasUtm && (
        // Client-side URL rewrite so first-touch attribution sees the KOL UTM.
        <script
          dangerouslySetInnerHTML={{
            __html: `history.replaceState(null,"",location.pathname+"?utm_source=${utm.source}&utm_medium=kol&utm_campaign=${utm.campaign}${q.code === "1" ? "&code=1" : ""}")`,
          }}
        />
      )}
      <section className="rise space-y-3">
        <p className="led text-sm">MRT Time × {creator.displayName}</p>
        <h1 className="text-4xl font-bold">{t("kol.welcome", { name: creator.displayName })}</h1>
        <p className="text-muted">{t("hero.sub")}</p>
        <p className="chip bg-led/15 text-led">{t("kol.code", { code: creator.code })}</p>
        <div className="flex gap-3">
          <Link href={localePath(locale, creator.landingVariant === "planner" ? "/plan" : "/#stations")} className="btn btn-primary">
            {t(creator.landingVariant === "planner" ? "hero.countdown.cta" : "hero.control.cta")}
          </Link>
        </div>
      </section>
      <StationGrid locale={locale} t={t} />
    </div>
  );
}
