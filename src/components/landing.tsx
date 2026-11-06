import Link from "next/link";
import { localePath, type Locale, type T } from "@/lib/i18n";
import { LINES, PLATFORMS, STATIONS } from "@/lib/network/data";
import { ExposureTracker } from "./trackers";
import { NewsletterForm } from "./voc/newsletter-form";
import { ShareButton } from "./share-button";
import { VersionFooter } from "./version-footer";
import { AdSlot } from "./ads/ad-slot";

export function StationGrid({ locale, t }: { locale: Locale; t: T }) {
  return (
    <section id="stations" className="space-y-3">
      <h2 className="text-xl font-semibold">{t("landing.stations")}</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {STATIONS.map((s) => (
          <li key={s.slug}>
            <Link href={localePath(locale, `/station/${s.slug}`)} className="panel flex items-center gap-2 px-4 py-3 hover:border-led">
              <span className="flex gap-1">
                {s.codes.map((c) => (
                  <span key={c} className="chip text-white" style={{ background: LINES[PLATFORMS[c].line].color }}>
                    {c}
                  </span>
                ))}
              </span>
              <span className="font-medium">{s.name[locale]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Visitor landing with the hero headline + CTA experiment. */
export function Landing({ locale, t, variant }: { locale: Locale; t: T; variant: string }) {
  const countdown = variant === "countdown";
  return (
    <div className="space-y-10 pt-6">
      <ExposureTracker experiment="landing_hero" variant={variant} />
      <section className="rise space-y-4">
        <p className="led text-sm">EW17 → TE19 · 3 min</p>
        <h1 className="text-4xl leading-tight font-bold tracking-tight sm:text-5xl">{t(countdown ? "hero.countdown.title" : "hero.control.title")}</h1>
        <p className="max-w-2xl text-lg text-muted">{t("hero.sub")}</p>
        <div className="flex flex-wrap gap-3">
          <Link href={localePath(locale, countdown ? "/plan" : "/#stations")} className="btn btn-primary">
            {t(countdown ? "hero.countdown.cta" : "hero.control.cta")}
          </Link>
          <Link href={localePath(locale, "/plan")} className="btn btn-secondary">
            {t("landing.planner")}
          </Link>
          <ShareButton path={localePath(locale, "/")} title="MRT Time" contentType="app" />
        </div>
        <VersionFooter />
      </section>
      <StationGrid locale={locale} t={t} />
      <AdSlot placement="landing" />
      <section className="panel space-y-2 p-5">
        <h2 className="text-xl font-semibold">{t("landing.how.title")}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>{t("landing.how.1")}</li>
          <li>{t("landing.how.2")}</li>
          <li>{t("landing.how.3")}</li>
        </ol>
      </section>
      <section id="newsletter" className="panel scroll-mt-24 space-y-3 p-5">
        <h2 className="font-semibold">{t("landing.newsletter")}</h2>
        <NewsletterForm />
      </section>
    </div>
  );
}
