import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";
import { getStation, LINES, PLATFORMS, STATIONS, stationsByDistance } from "@/lib/network";
import { pageMetadata, stationJsonLd } from "@/lib/seo";
import { stationBoard } from "@/lib/server/board";
import { crowdForStations, lineAlerts } from "@/lib/server/lta";
import { LiveBoard } from "@/components/board/live-board";
import { JsonLd } from "@/components/json-ld";
import { ShareButton } from "@/components/share-button";
import { StationTracker } from "@/components/trackers";
import { AdSlot } from "@/components/ads/ad-slot";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const station = getStation(slug);
  const { locale, t } = await getT();
  if (!station) return { title: t("notFound.title") };
  const name = station.name[locale];
  return pageMetadata({
    locale,
    path: `/station/${slug}`,
    title: `${name} MRT (${station.codes.join(" / ")}) — ${t("board.title")}`,
    description: `${t("station.faq.q1", { station: name })} ${t("station.faq.a2")}`,
    image: `/station/${slug}/opengraph-image`,
  });
}

export default async function StationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const station = getStation(slug);
  if (!station) notFound();
  const { locale, t } = await getT();
  const [board, alerts, crowd] = await Promise.all([
    stationBoard(slug).catch(() => null),
    lineAlerts().catch(() => null),
    crowdForStations(station.codes).catch(() => null),
  ]);
  const name = station.name[locale];
  const firstLine = PLATFORMS[station.codes[0]].line;
  return (
    <article className="space-y-6 pt-6">
      <JsonLd data={stationJsonLd(station, locale)} />
      <StationTracker station={slug} line={firstLine} />
      <header className="space-y-2">
        <div className="flex gap-1">
          {station.codes.map((c) => (
            <span key={c} className="chip text-white" style={{ background: LINES[PLATFORMS[c].line].color }}>
              {c}
            </span>
          ))}
        </div>
        <h1 className="text-3xl font-bold">{name}</h1>
        <p className="text-sm text-muted">
          {t("station.lines")}: {[...new Set(station.codes.map((c) => LINES[PLATFORMS[c].line].name[locale]))].join(" · ")}
        </p>
        <ShareButton path={localePath(locale, `/station/${slug}`)} title={`${name} · MRT Time`} contentType="station" />
      </header>
      <LiveBoard slug={slug} initial={{ board, alerts, crowd }} />
      <AdSlot placement="station" station={slug} />
      {station.exits.length + station.nearby.length > 0 && (
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="panel p-4">
          <h2 className="font-semibold">{t("station.exits")}</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted">
            {station.exits.map((e) => (
              <li key={e.en}>{e[locale]}</li>
            ))}
          </ul>
        </div>
        <div className="panel p-4">
          <h2 className="font-semibold">{t("station.nearby")}</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted">
            {station.nearby.map((e) => (
              <li key={e.en}>{e[locale]}</li>
            ))}
          </ul>
        </div>
      </section>
      )}
      <section aria-label={t("ads.sponsored")} className="space-y-2">
        <h2 className="text-xs tracking-wide text-muted uppercase">{t("ads.sponsored")}</h2>
        <AdSlot placement="station_sponsored" station={slug} />
      </section>
      <section className="panel space-y-3 p-4">
        <h2 className="font-semibold">{t("station.faq")}</h2>
        {(["1", "2", "3"] as const).map((n) => (
          <details key={n} className="text-sm">
            <summary className="cursor-pointer font-medium">{t(`station.faq.q${n}`, { station: name })}</summary>
            <p className="mt-1 text-muted">{t(`station.faq.a${n}`, { station: name })}</p>
          </details>
        ))}
      </section>
      <nav className="text-sm">
        <h2 className="mb-2 font-semibold">{t("stations.nearby")}</h2>
        <ul className="flex flex-wrap gap-2">
          {stationsByDistance(station.lat, station.lng)
            .filter((s) => s.station.slug !== slug)
            .slice(0, 10)
            .map(({ station: s }) => (
              <li key={s.slug}>
                <Link className="rounded-full border border-line px-3 py-1" href={localePath(locale, `/station/${s.slug}`)}>
                  {s.name[locale]}
                </Link>
              </li>
            ))}
          <li>
            <Link className="rounded-full border border-led px-3 py-1 text-led" href={localePath(locale, "/stations")}>
              {t("stations.all", { n: STATIONS.length })}
            </Link>
          </li>
        </ul>
      </nav>
    </article>
  );
}
