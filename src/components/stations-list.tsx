"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Star } from "lucide-react";
import { LINES, PLATFORMS, STATIONS, type Station } from "@/lib/network";
import { useAnalytics } from "./analytics/analytics-provider";
import { useI18n } from "./i18n";
import { useNearestStation } from "./geo/geo-suggest";
import {
  filterStations,
  getLineGroups,
  sortAlphabetical,
  sortFrequent,
  sortNearby,
  type StationTab,
} from "@/lib/stations/list";
import {
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

        {/* Inline next train for pinned rows */}
        {inlineNextTrain && (
          <span
            className="ml-auto shrink-0 font-mono text-sm font-semibold tabular text-led"
            aria-label={t("stations.nextTrain")}
          >
            {inlineNextTrain}
          </span>
        )}
      </Link>
    </div>
  );
}

/**
 * Stations list with sticky search, segmented sort controls, Pinned, Recent,
 * and collapsible line groups.
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
    const t = setInterval(() => setNow(Date.now()), 10_000);
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

  const stationMap = useMemo(() => new Map(STATIONS.map((s) => [s.slug, s])), []);
  const pinnedStations = useMemo(
    () => pinnedSlugs.map((slug) => stationMap.get(slug)!).filter(Boolean),
    [pinnedSlugs, stationMap]
  );
  const recentStations = useMemo(
    () => recentSlugs.map((slug) => stationMap.get(slug)!).filter(Boolean),
    [recentSlugs, stationMap]
  );

  // Lazily fetch inline next train for pinned stations (max 3)
  useEffect(() => {
    const pinnedToFetch = pinnedSlugs.slice(0, 3);
    if (!pinnedToFetch.length) return;

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

    pinnedToFetch.forEach((slug) => void fetchBoard(slug));

    return () => {
      cancelled = true;
    };
  }, [pinnedSlugs, t]);

  // Near me analytics tracking
  const firstNear = geo.order?.[0];
  const shownNear = useRef<string | null>(null);
  useEffect(() => {
    if (tab === "near" && firstNear && shownNear.current !== firstNear) {
      shownNear.current = firstNear;
      track("geo_suggest_shown", { station: firstNear, surface: "stations" });
    }
  }, [tab, firstNear, track]);

  // Main sorted list according to active tab
  const sortedStations = useMemo(() => {
    if (tab === "frequent") {
      return sortFrequent(STATIONS, frequentSlugs, locale);
    }
    if (tab === "near") {
      return sortNearby(STATIONS, geo.order, locale);
    }
    if (tab === "az") {
      return sortAlphabetical(STATIONS, locale);
    }
    return STATIONS;
  }, [tab, frequentSlugs, geo.order, locale]);

  const lineGroups = useMemo(() => getLineGroups(), []);
  const searchResults = useMemo(() => filterStations(STATIONS, query), [query]);

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
        <section aria-label={t("stations.title")} className="space-y-2">
          <ul className="grid gap-2 sm:grid-cols-2">
            {searchResults.map((s) => (
              <li key={s.slug}>
                <StationRow
                  s={s}
                  isPinnedStation={pinnedSlugs.includes(s.slug)}
                  onTogglePin={togglePinState}
                />
              </li>
            ))}
          </ul>
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

          {/* Sections above the list: Pinned (max 3 with inline next train) and Recent (last 5) */}
          <div className="space-y-4">
            {pinnedStations.length > 0 && (
              <section className="space-y-2" aria-label={t("stations.section.pinned")}>
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    {t("stations.section.pinned")}
                  </h2>
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
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {pinnedStations.map((s) => (
                    <li key={`pinned-${s.slug}`}>
                      <StationRow
                        s={s}
                        isPinnedStation={true}
                        onTogglePin={togglePinState}
                        inlineNextTrain={pinnedArrivals[s.slug] ?? "—"}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {recentStations.length > 0 && (
              <section className="space-y-2" aria-label={t("stations.section.recent")}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {t("stations.section.recent")}
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {recentStations.map((s) => (
                    <li key={`recent-${s.slug}`}>
                      <StationRow
                        s={s}
                        isPinnedStation={pinnedSlugs.includes(s.slug)}
                        onTogglePin={togglePinState}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Empty state for My stations when no pinned or recent stations */}
            {pinnedStations.length === 0 && recentStations.length === 0 && (
              <div className="panel flex min-h-[56px] items-center justify-center p-4 text-center text-sm text-muted">
                {t("stations.empty.myStations")}
              </div>
            )}
          </div>

          {/* Sorted list or By line groups */}
          {tab === "line" ? (
            <div className="space-y-2">
              {lineGroups.map((group) => (
                <details key={group.code} className="panel group overflow-hidden">
                  <summary className="flex min-h-[56px] cursor-pointer items-center justify-between p-4 font-semibold select-none transition-colors hover:bg-panel-2/50">
                    <span className="flex items-center gap-2.5">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: group.color }} aria-hidden />
                      <span className="text-[17px] font-semibold">{group.name[locale]}</span>
                    </span>
                    <ChevronDown
                      size={18}
                      className="text-muted transition-transform duration-200 group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>
                  <div className="border-t border-line p-2">
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {group.stations.map((s) => (
                        <li key={`${group.code}-${s.slug}`}>
                          <StationRow
                            s={s}
                            isPinnedStation={pinnedSlugs.includes(s.slug)}
                            onTogglePin={togglePinState}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <section aria-label={t("stations.title")} className="space-y-2">
              <ul className="grid gap-2 sm:grid-cols-2">
                {sortedStations.map((s) => (
                  <li key={s.slug}>
                    <StationRow
                      s={s}
                      isPinnedStation={pinnedSlugs.includes(s.slug)}
                      onTogglePin={togglePinState}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
