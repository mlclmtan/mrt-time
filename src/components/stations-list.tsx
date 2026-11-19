"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Star } from "lucide-react";
import { LINES, PLATFORMS, STATIONS, type Station } from "@/lib/network";
import { useAnalytics } from "./analytics/analytics-provider";
import { useI18n } from "./i18n";
import { useNearestStation } from "./geo/geo-suggest";
import type { StationTab } from "@/lib/stations/list";
import {
  buildStationSections,
  defaultStationTab,
  loadUsage,
  rankFrequent,
  recent,
  toggleStationPin,
  USAGE_CHANGE_EVENT,
  type StationUsageState,
} from "@/lib/stations/usage";
import { getSnapshot, saveSnapshot, ageLabel } from "@/lib/snapshot-cache";

function StationRow({
  s,
  isPinnedStation,
  onTogglePin,
  inlineNextTrain,
}: {
  s: Station;
  isPinnedStation: boolean;
  onTogglePin: (slug: string) => void;
  inlineNextTrain?: string | null;
}) {
  const { locale, href, t } = useI18n();
  const primaryName = locale === "zh-Hant" ? s.name["zh-Hant"] : s.name.en;
  const secondaryName = locale === "zh-Hant" ? s.name.en : s.name["zh-Hant"];

  return (
    <div className="panel flex min-h-[56px] items-center gap-2.5 px-3 py-2 transition-colors hover:border-led">
      {/* 44x44 star button to toggle pin */}
      <button
        type="button"
        aria-label={isPinnedStation ? t("stations.action.unpin") : t("stations.action.pin")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-transform hover:text-ink active:scale-95"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTogglePin(s.slug);
        }}
      >
        <Star
          size={20}
          className={isPinnedStation ? "fill-led text-led" : "text-muted hover:text-ink"}
          aria-hidden
        />
      </button>

      {/* Tappable link for the station */}
      <Link href={href(`/station/${s.slug}`)} className="flex min-h-[44px] flex-1 items-center gap-2.5 overflow-hidden">
        {/* Line code chips: >= 13px */}
        <span className="flex shrink-0 flex-wrap gap-1">
          {s.codes.map((c) => (
            <span
              key={c}
              className="chip px-2 py-0.5 text-[13px] font-semibold text-white"
              style={{ background: LINES[PLATFORMS[c].line].color }}
            >
              {c}
            </span>
          ))}
        </span>

        {/* Station names: primary >= 17px, secondary >= 13px; in zh-Hant Chinese first */}
        <div className="flex flex-1 flex-wrap items-baseline gap-x-2 truncate">
          <span className="text-[17px] font-semibold leading-snug">{primaryName}</span>
          <span className="text-[13px] text-muted">{secondaryName}</span>
        </div>

        {/* Inline next train for pinned / recent rows */}
        {inlineNextTrain !== undefined && (
          <div className="ml-auto shrink-0 flex items-center justify-end min-w-[56px]">
            {inlineNextTrain === "loading" ? (
              <span className="inline-block h-4 w-10 rounded bg-panel-2 animate-pulse" aria-hidden />
            ) : (
              <span
                className="font-mono text-sm font-semibold tabular text-led"
                aria-label={t("stations.nextTrain")}
              >
                {inlineNextTrain}
              </span>
            )}
          </div>
        )}
      </Link>
    </div>
  );
}

/**
 * Stations list with sticky search, segmented sort controls, Pinned, Recent,
 * and deduplicated station sections.
 */
export function StationsList() {
  const { t, locale } = useI18n();
  const { track } = useAnalytics();
  const [query, setQuery] = useState("");
  const [usage, setUsage] = useState<StationUsageState>(loadUsage);
  const [tab, setTab] = useState<StationTab>(() => defaultStationTab(loadUsage()));
  const userInteractedTab = useRef(false);
  const [pinnedArrivals, setPinnedArrivals] = useState<Record<string, string>>(
    () => getSnapshot<Record<string, string>>("stations")?.data ?? {},
  );
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<number | null>(
    () => getSnapshot<Record<string, string>>("stations")?.savedAt ?? null,
  );
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const geo = useNearestStation();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Sync usage on change events
  useEffect(() => {
    const handleUpdate = () => {
      const u = loadUsage();
      setUsage(u);
      if (!userInteractedTab.current) {
        setTab(defaultStationTab(u));
      }
    };
    handleUpdate();
    window.addEventListener(USAGE_CHANGE_EVENT, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(USAGE_CHANGE_EVENT, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  const togglePinState = useCallback(
    (slug: string) => {
      const isPinned = (usage.pins || []).includes(slug);
      const action = isPinned ? ("unpin" as const) : ("pin" as const);
      track("station_pin", { action, station: slug });
      const next = toggleStationPin(slug);
      setUsage(next);
    },
    [usage.pins, track],
  );

  const pinnedSlugs = useMemo(() => usage.pins || [], [usage.pins]);
  const frequentSlugs = useMemo(() => rankFrequent(usage), [usage]);
  const recentSlugs = useMemo(() => recent(usage, 5, pinnedSlugs), [usage, pinnedSlugs]);

  // Lazily fetch inline next train for Pinned (max 3) and Recent (max 5) stations
  useEffect(() => {
    const toFetch = [...new Set([...pinnedSlugs.slice(0, 3), ...recentSlugs.slice(0, 5)])];
    if (!toFetch.length) return;

    let cancelled = false;

    const fetchBoard = async (slug: string) => {
      setIsRevalidating(true);
      try {
        const res = await fetch(`/api/board?station=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("fetch error");
        const body = await res.json();
        if (cancelled) return;

        const platforms: Array<{ directions?: Array<{ prediction?: { arrivals?: Array<{ inMin?: number }> } }> }> =
          body?.board?.platforms ?? [];
        const arrivals = platforms
          .flatMap((p) => p.directions ?? [])
          .flatMap((d) => d.prediction?.arrivals ?? [])
          .filter((a): a is { inMin: number } => typeof a?.inMin === "number" && a.inMin >= 0);

        if (!arrivals.length) {
          setPinnedArrivals((prev) => {
            const next = { ...prev, [slug]: "—" };
            saveSnapshot("stations", next);
            setSnapshotSavedAt(Date.now());
            return next;
          });
          return;
        }

        const next = arrivals.sort((a, b) => a.inMin - b.inMin)[0];
        const text = next.inMin === 0 ? t("board.due") : t("board.in", { n: next.inMin });
        setPinnedArrivals((prev) => {
          const updated = { ...prev, [slug]: text };
          saveSnapshot("stations", updated);
          setSnapshotSavedAt(Date.now());
          return updated;
        });
      } catch {
        if (!cancelled) {
          setPinnedArrivals((prev) => ({ ...prev, [slug]: "—" }));
        }
      } finally {
        if (!cancelled) setIsRevalidating(false);
      }
    };

    toFetch.forEach((slug) => void fetchBoard(slug));

    return () => {
      cancelled = true;
    };
  }, [pinnedSlugs, recentSlugs, t]);

  // Near me analytics tracking
  const firstNear = geo.order?.[0];
  const shownNear = useRef<string | null>(null);
  useEffect(() => {
    if (tab === "near" && firstNear && shownNear.current !== firstNear) {
      shownNear.current = firstNear;
      track("geo_suggest_shown", { station: firstNear, surface: "stations" });
    }
  }, [tab, firstNear, track]);

  const sections = useMemo(
    () =>
      buildStationSections({
        stations: STATIONS,
        pins: pinnedSlugs,
        recent: recentSlugs,
        mode: tab,
        query,
        locale,
        nearOrder: geo.order,
        frequentSlugs,
      }),
    [pinnedSlugs, recentSlugs, tab, query, locale, geo.order, frequentSlugs],
  );

  return (
    <div className="space-y-4">
      {/* Sticky search field: 52px tall, text >= 17px */}
      <div className="sticky top-[calc(49px+env(safe-area-inset-top,0px))] z-20 -mx-4 bg-bg/95 px-4 py-2 backdrop-blur">
        <div className="relative flex items-center">
          <Search size={20} className="pointer-events-none absolute left-3.5 text-muted" aria-hidden />
          <input
            type="search"
            className="field h-[52px] min-h-[52px] pl-11 pr-4 text-[17px] placeholder:text-muted"
            placeholder={t("stations.searchPlaceholder")}
            aria-label={t("stations.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {/* When searching, show search results directly */}
      {query.trim() ? (
        <section aria-label={t("stations.section.search")} className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
              {t("stations.section.search")} ({sections[0]?.stations.length ?? 0})
            </h2>
          </div>
          {sections[0]?.stations.length === 0 ? (
            <div className="panel p-4 text-center text-sm text-muted">
              {locale === "zh-Hant" ? "找不到符合的車站" : "No stations found"}
            </div>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {sections[0]?.stations.map((s) => (
                <li key={`search-${s.slug}`}>
                  <StationRow
                    s={s}
                    isPinnedStation={pinnedSlugs.includes(s.slug)}
                    onTogglePin={togglePinState}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {/* Segmented control: Frequent · Near me · A–Z · By line (each >= 44px) */}
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-panel p-1 text-sm font-medium" role="tablist">
            {(["frequent", "near", "az", "line"] as const).map((key) => {
              const active = tab === key;
              const label =
                key === "near"
                  ? t("stations.tab.nearMe")
                  : key === "line"
                    ? t("stations.tab.byLine")
                    : t(`stations.tab.${key}`);

              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`flex min-h-[44px] items-center justify-center rounded-lg px-2 text-center text-sm font-medium transition-colors ${
                    active ? "bg-panel-2 font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                  onClick={() => {
                    userInteractedTab.current = true;
                    if (tab !== key) {
                      track("station_sort", { mode: key });
                    }
                    setTab(key);
                    if (key === "near" && geo.state !== "ok") {
                      geo.allow();
                    }
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Near me status message */}
          {tab === "near" && (
            <p className="text-xs text-muted">
              {geo.state === "denied"
                ? t("geo.denied")
                : geo.state === "locating"
                  ? t("geo.locating")
                  : t("geo.private")}
            </p>
          )}

          {/* Empty hint when frequent tab has no pinned or recent stations */}
          {tab === "frequent" && pinnedSlugs.length === 0 && recentSlugs.length === 0 && (
            <div className="panel flex min-h-[56px] items-center justify-center p-4 text-center text-sm text-muted">
              {t("stations.empty.myStations")}
            </div>
          )}

          {/* Render sections: in Frequent -> Pinned (if any), Recent (if any), All stations */}
          {/* in A-Z / Near me / By line -> All stations flat list */}
          <div className="space-y-4">
            {sections.map((section) => (
              <section key={section.id} className="space-y-2" aria-label={t(section.titleKey)}>
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {t(section.titleKey)} ({section.stations.length})
                  </h2>
                  {section.id === "pinned" && (
                    <div className="flex items-center gap-2">
                      {isRevalidating && (
                        <span className="text-xs font-medium text-muted animate-pulse">
                          {t("snap.updating")}
                        </span>
                      )}
                      {!isRevalidating && snapshotSavedAt && ageLabel(snapshotSavedAt, now, locale) && (
                        <span className="text-xs font-medium text-muted">
                          {ageLabel(snapshotSavedAt, now, locale)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {section.stations.map((s) => (
                    <li key={`${section.id}-${s.slug}`}>
                      <StationRow
                        s={s}
                        isPinnedStation={pinnedSlugs.includes(s.slug)}
                        onTogglePin={togglePinState}
                        inlineNextTrain={
                          section.id === "pinned" || section.id === "recent"
                            ? (pinnedArrivals[s.slug] ?? (isRevalidating ? "loading" : "—"))
                            : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
