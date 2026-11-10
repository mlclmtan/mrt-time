import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { ownerJourneys, ownerPlaces } from "@/lib/server/journeys";
import { legRideMin } from "@/lib/journey/plan";
import { saveLegMinutes } from "./actions";
import Link from "next/link";
import { dbConfigured } from "@/lib/db";
import { todaysEvents } from "@/lib/server/trips";
import { localePath } from "@/lib/i18n";
import { MeTimeline } from "@/components/owner/me-timeline";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MePage() {
  const session = await getSession();
  if (session?.user.role !== "owner") redirect("/sign-in");
  const { t, locale } = await getT();
  const [journeys, places, today] = await Promise.all([
    ownerJourneys(session.user.id),
    ownerPlaces(session.user.id).catch(() => []),
    dbConfigured() ? todaysEvents(session.user.id).catch(() => []) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-6 pt-6" data-clarity-mask="True">
      <h1 className="text-3xl font-bold">{t("nav.me")}</h1>
      <section className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-semibold">{t("timeline.title", { n: today.length })}</h2>
          <Link href={localePath(locale, "/me/stats")} className="ml-auto text-sm text-accent underline">
            {t("stats.link")}
          </Link>
        </div>
        <MeTimeline initial={today} />
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        {places.map((p) => (
          <div key={p.id} className="panel p-4 text-sm">
            <div className="font-semibold">{p.label}</div>
            <div className="text-muted">
              {p.station ?? ""} {p.exit ? `· ${p.exit}` : ""}
            </div>
          </div>
        ))}
      </section>
      {journeys.length === 0 && <p className="text-muted">{t("common.none")}</p>}
      {journeys.map((j) => (
        <form key={j.key} action={saveLegMinutes} className="panel space-y-3 p-4">
          <input type="hidden" name="key" value={j.key} />
          <h2 className="font-semibold">
            {j.name} {j.sheltered ? "☂︎" : ""}
          </h2>
          <ol className="space-y-2 text-sm">
            {j.legs.map((leg, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-56 text-muted">
                  {leg.kind === "ride" ? `${leg.line} ${leg.from} → ${leg.to}` : leg.kind === "walk" ? (leg.label ?? t("plan.walk", { n: "" })) : t("plan.transfer", { n: "" })}
                </span>
                <input
                  name={`leg-${i}`}
                  type="number"
                  min={0}
                  max={120}
                  step={0.5}
                  defaultValue={leg.kind === "ride" ? legRideMin(leg) : leg.min}
                  className="field w-24"
                  aria-label={`${j.name} leg ${i + 1} ${t("unit.min")}`}
                />
                <span className="text-muted">{t("unit.min")}</span>
                {leg.tip && <span className="text-xs text-led">{leg.tip}</span>}
              </li>
            ))}
          </ol>
          <button className="btn btn-primary py-2 text-sm">{t("common.save")}</button>
        </form>
      ))}
    </div>
  );
}
