"use client";
import { useMemo, useState } from "react";
import { directionChoices, getDirection, getPlatform, searchStations, stationForCode } from "@/lib/network";
import { useI18n } from "../i18n";
import { GeoSuggest, type Surface } from "../geo/geo-suggest";

export type PlatformChoice = { station: string; direction: string };

/** "Tiong Bahru → Pasir Ris · change": the platform a tap is for, one tap to change. */
export function PlatformPicker({
  value,
  onChange,
  surface,
  startOpen = false,
  geo = true,
}: {
  value: PlatformChoice | null;
  onChange: (v: PlatformChoice) => void;
  surface: Surface;
  startOpen?: boolean;
  /** Offer "You're at …?" from GPS. Off on Home while a journey step is set: GPS never overrides it. */
  geo?: boolean;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(startOpen || !value);
  const [slug, setSlug] = useState<string | null>(value ? (stationForCode(value.station)?.slug ?? null) : null);
  const [query, setQuery] = useState("");
  const results = useMemo(() => (query ? searchStations(query).slice(0, 12) : []), [query]);
  const choices = useMemo(() => (slug ? directionChoices(slug) : []), [slug]);
  const station = value ? stationForCode(value.station) : undefined;
  const platform = value ? getPlatform(value.station) : undefined;
  const dir = value && platform ? getDirection(platform.line, value.direction) : undefined;
  const multiLine = new Set(choices.map((c) => c.line)).size > 1;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {station && dir ? (
          <span className="font-semibold">
            {t("picker.current", { station: station.name[locale], dest: dir.board[locale] })}
            <span className="ml-1 text-xs text-muted">{value?.station}</span>
          </span>
        ) : (
          <span className="text-muted">{t("picker.none")}</span>
        )}
        <button type="button" className="text-accent underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {t("entry.change")}
        </button>
      </div>
      {geo && (
      <GeoSuggest
        surface={surface}
        current={station?.slug}
        onPick={(s) => {
          setSlug(s);
          setOpen(true);
          const first = directionChoices(s)[0];
          if (first && directionChoices(s).length === 1) onChange({ station: first.station, direction: first.direction });
        }}
      />
      )}
      {open && (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <input type="search" className="field" placeholder={t("add.search")} aria-label={t("add.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
          {results.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {results.map((s) => (
                <li key={s.slug}>
                  <button
                    type="button"
                    className={`rounded-full border px-3 py-1 text-sm ${s.slug === slug ? "border-led text-led" : "border-line"}`}
                    onClick={() => {
                      setSlug(s.slug);
                      setQuery("");
                    }}
                  >
                    {s.name[locale]}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {slug && (
            <div className="grid grid-cols-2 gap-2">
              {choices.map((c) => {
                const on = value?.station === c.station && value.direction === c.direction;
                return (
                  <button
                    key={`${c.station}-${c.direction}`}
                    type="button"
                    aria-pressed={on}
                    className={`btn min-h-12 flex-col items-start gap-0.5 text-left ${on ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => {
                      onChange({ station: c.station, direction: c.direction });
                      setOpen(false);
                    }}
                  >
                    {multiLine && (
                      <span className="chip text-[10px] text-white" style={{ background: c.color }}>
                        {c.station}
                      </span>
                    )}
                    <span className="font-bold">{c.board[locale]}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
