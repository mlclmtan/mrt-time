"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { LINES, LINE_CODES, PLATFORMS, STATIONS, searchStations, type Station } from "@/lib/network";
import { useAnalytics } from "./analytics/analytics-provider";
import { useI18n } from "./i18n";
import { useNearestStation } from "./geo/geo-suggest";

function Row({ s }: { s: Station }) {
  const { locale, href } = useI18n();
  return (
    <Link href={href(`/station/${s.slug}`)} className="panel flex items-center gap-2 px-3 py-2.5 hover:border-led">
      <span className="flex gap-1">
        {s.codes.map((c) => (
          <span key={c} className="chip text-[10px] text-white" style={{ background: LINES[PLATFORMS[c].line].color }}>
            {c}
          </span>
        ))}
      </span>
      <span className="font-medium">{s.name[locale]}</span>
      <span className="ml-auto text-xs text-muted">{locale === "en" ? s.name["zh-Hant"] : s.name.en}</span>
    </Link>
  );
}

/** Every station: search (EN / 中文 / code), by line, or nearest first (location stays on the device). */
export function StationsList() {
  const { t, locale } = useI18n();
  const { track } = useAnalytics();
  const [query, setQuery] = useState("");
  const geo = useNearestStation();
  const [near, setNear] = useState(false);
  const found = useMemo(() => searchStations(query), [query]);
  const nearby = near && geo.order ? geo.order.map((slug) => STATIONS.find((s) => s.slug === slug)!).filter(Boolean) : null;
  const first = nearby?.[0]?.slug;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (first && shown.current !== first) {
      shown.current = first;
      track("geo_suggest_shown", { station: first, surface: "stations" });
    }
  }, [first, track]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" className="field flex-1" placeholder={t("add.search")} aria-label={t("add.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <button
          type="button"
          aria-pressed={near}
          className={`btn px-3 py-2 text-sm ${near ? "btn-primary" : "btn-secondary"}`}
          onClick={() => {
            if (!near && geo.state !== "ok") geo.allow();
            setNear((v) => !v);
          }}
        >
          <MapPin size={14} aria-hidden /> {t("stations.nearMe")}
        </button>
      </div>
      {near && <p className="text-xs text-muted">{geo.state === "denied" ? t("geo.denied") : geo.state === "locating" ? t("geo.locating") : t("geo.private")}</p>}
      {query ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {found.map((s) => (
            <li key={s.slug}>
              <Row s={s} />
            </li>
          ))}
        </ul>
      ) : nearby ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {nearby.slice(0, 20).map((s) => (
            <li key={s.slug}>
              <Row s={s} />
            </li>
          ))}
        </ul>
      ) : (
        LINE_CODES.map((code) => {
          const stations = [...new Map(Object.values(PLATFORMS).filter((p) => p.line === code).sort((a, b) => a.order - b.order).map((p) => [p.station, STATIONS.find((s) => s.slug === p.station)!])).values()];
          return (
            <section key={code} className="space-y-2">
              <h2 className="flex items-center gap-2 font-semibold">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: LINES[code].color }} aria-hidden />
                {LINES[code].name[locale]}
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {stations.map((s) => (
                  <li key={s.slug}>
                    <Row s={s} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
