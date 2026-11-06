"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { directionChoices, getStation, PLATFORMS, searchStations } from "@/lib/network";
import { lastUsedStation } from "@/lib/readings/entry";
import { useI18n } from "./i18n";
import { QuickEntry } from "./board/quick-entry";

/**
 * Add a reading on one screen: 1 station → 2 which way → 3 the minutes on
 * the board. Time seen is now unless changed. Built for one hand at 393×852.
 */
export function AddReading({ defaultStation, defaultDirection }: { defaultStation?: string | null; defaultDirection?: string | null }) {
  const { t, locale, href } = useI18n();
  // Server default = the owner's next journey platform (code); last used wins on the client.
  const [slug, setSlug] = useState<string | null>(() => (defaultStation ? (PLATFORMS[defaultStation]?.station ?? null) : null));
  const [choice, setChoice] = useState<{ station: string; direction: string } | null>(() =>
    defaultStation && defaultDirection ? { station: defaultStation, direction: defaultDirection } : null,
  );
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(!slug);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  useEffect(() => {
    const last = lastUsedStation();
    const lastSlug = last ? PLATFORMS[last]?.station : null;
    if (!lastSlug) return;
    const id = setTimeout(() => {
      setSlug(lastSlug);
      setChoice((c) => (c && PLATFORMS[c.station]?.station === lastSlug ? c : null));
      setPicking(false);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const station = slug ? getStation(slug) : undefined;
  const choices = useMemo(() => (slug ? directionChoices(slug) : []), [slug]);
  const results = useMemo(() => searchStations(query), [query]);
  const picked = choice && choices.find((c) => c.station === choice.station && c.direction === choice.direction);
  const multiLine = new Set(choices.map((c) => c.line)).size > 1;

  return (
    <div className="space-y-4">
      {/* 1 · Station */}
      <section className="panel p-4">
        <h2 className="text-sm font-semibold text-muted">{t("add.station")}</h2>
        {station && !picking ? (
          <div className="mt-2 flex items-center gap-3">
            <span className="text-2xl font-bold">{station.name[locale]}</span>
            <span className="text-sm text-muted">{locale === "en" ? station.name["zh-Hant"] : station.name.en}</span>
            <button type="button" className="ml-auto text-sm text-accent underline" onClick={() => setPicking(true)}>
              {t("add.changeStation")}
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <input
              type="search"
              className="field"
              placeholder={t("add.search")}
              aria-label={t("add.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto">
              {results.map((s) => (
                <li key={s.slug}>
                  <button
                    type="button"
                    className={`btn w-full flex-col items-start gap-0 text-left ${s.slug === slug ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => {
                      setSlug(s.slug);
                      setChoice(null);
                      setPicking(false);
                      setQuery("");
                    }}
                  >
                    <span className="font-semibold">{s.name.en}</span>
                    <span className="text-xs opacity-80">{s.name["zh-Hant"]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 2 · Which way */}
      {station && !picking && (
        <section className="panel p-4">
          <h2 className="text-sm font-semibold text-muted">{t("add.direction")}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {choices.map((c) => {
              const on = picked === c;
              return (
                <button
                  key={`${c.station}-${c.direction}`}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setChoice({ station: c.station, direction: c.direction })}
                  className={`btn min-h-16 flex-col items-start gap-1 text-left ${on ? "btn-primary" : "btn-secondary"}`}
                >
                  {multiLine && (
                    <span className="chip text-[10px] text-white" style={{ background: c.color }}>
                      {c.station}
                    </span>
                  )}
                  <span className="text-lg leading-tight font-bold">{c.board[locale]}</span>
                  {c.alsoBoard.length > 0 && (
                    <span className="text-xs opacity-80">{t("add.alsoEnds", { names: c.alsoBoard.map((b) => b[locale]).join(", ") })}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 3 · The minutes */}
      {picked && (
        <section className="panel p-4">
          <h2 className="text-sm font-semibold text-muted">{t("add.minutes")}</h2>
          <QuickEntry
            key={`${picked.station}-${picked.direction}`}
            station={picked.station}
            line={picked.line}
            direction={picked.direction}
            destination={picked.board[locale]}
            startOpen
            onSaved={() => setSavedTo(slug)}
          />
          {savedTo && (
            <Link href={href(`/station/${savedTo}`)} className="mt-3 inline-block text-sm font-semibold text-accent underline">
              {t("add.seeTimes")}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
