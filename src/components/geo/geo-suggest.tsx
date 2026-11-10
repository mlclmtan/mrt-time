"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, X } from "lucide-react";
import { nearestStation, stationsByDistance, type Station } from "@/lib/network";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";

/**
 * Nearest station from the browser's location. Coordinates are used once,
 * on the device, to pick a station and then dropped: never stored, never
 * sent. Only the choice "use my location" is remembered (localStorage).
 */
export const GEO_PREF_KEY = "mrt_geo";
type GeoState = "idle" | "locating" | "ok" | "far" | "denied" | "unavailable";
export type Surface = "home" | "add" | "boarding" | "stations";

export function useNearestStation() {
  const [state, setState] = useState<GeoState>("idle");
  const [station, setStation] = useState<Station | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return setState("unavailable");
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const near = nearestStation(latitude, longitude);
        setOrder(stationsByDistance(latitude, longitude).map((s) => s.station.slug));
        setStation(near?.station ?? null);
        setState(near ? "ok" : "far");
      },
      () => setState("denied"),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  }, []);

  // Already allowed on this device: look up the nearest station quietly.
  useEffect(() => {
    let stopped = false;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      const id = setTimeout(() => setState("unavailable"), 0);
      return () => clearTimeout(id);
    }
    if (localStorage.getItem(GEO_PREF_KEY) !== "on") return;
    const check = navigator.permissions?.query({ name: "geolocation" as PermissionName });
    void check?.then((p) => !stopped && p.state === "granted" && locate()).catch(() => null);
    return () => {
      stopped = true;
    };
  }, [locate]);

  const allow = useCallback(() => {
    localStorage.setItem(GEO_PREF_KEY, "on");
    locate();
  }, [locate]);
  const decline = useCallback(() => {
    localStorage.setItem(GEO_PREF_KEY, "off");
    setState("idle");
  }, []);
  return { state, station, order, allow, decline };
}

/**
 * "You're at Tiong Bahru?" — one tap to use the nearest station. The first
 * time, a plain explanation comes before the browser asks for location.
 */
export function GeoSuggest({ surface, current, onPick }: { surface: Surface; current?: string | null; onPick: (slug: string) => void }) {
  const { t, locale } = useI18n();
  const { track } = useAnalytics();
  const geo = useNearestStation();
  const [explain, setExplain] = useState(false);
  const [hidden, setHidden] = useState(false);
  const shown = useRef<string | null>(null);
  const suggest = geo.state === "ok" && geo.station && geo.station.slug !== current && !hidden ? geo.station : null;

  useEffect(() => {
    if (suggest && shown.current !== suggest.slug) {
      shown.current = suggest.slug;
      track("geo_suggest_shown", { station: suggest.slug, surface });
    }
  }, [suggest, surface, track]);

  if (geo.state === "unavailable" || hidden) return null;
  if (suggest)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" data-geo-suggest={suggest.slug}>
        <MapPin size={14} aria-hidden className="text-led" />
        <span>{t("geo.youreAt", { station: suggest.name[locale] })}</span>
        <button
          type="button"
          className="rounded-full border border-led px-3 py-1 font-semibold text-led"
          onClick={() => {
            track("geo_suggest_accepted", { station: suggest.slug, surface });
            onPick(suggest.slug);
            setHidden(true);
          }}
        >
          {t("geo.yes")}
        </button>
        <button type="button" aria-label={t("geo.dismiss")} className="text-muted" onClick={() => setHidden(true)}>
          <X size={14} aria-hidden />
        </button>
      </div>
    );
  if (geo.state === "locating") return <p className="text-xs text-muted">{t("geo.locating")}</p>;
  if (geo.state === "denied") return <p className="text-xs text-muted">{t("geo.denied")}</p>;
  if (geo.state === "far") return <p className="text-xs text-muted">{t("geo.far")}</p>;
  if (geo.state === "ok") return null;
  return explain ? (
    <div className="rounded-lg border border-line p-3 text-sm">
      <p>{t("geo.explain")}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn btn-primary px-3 py-1.5 text-sm" onClick={() => { setExplain(false); geo.allow(); }}>
          {t("geo.allow")}
        </button>
        <button type="button" className="btn btn-secondary px-3 py-1.5 text-sm" onClick={() => { setExplain(false); geo.decline(); }}>
          {t("geo.notNow")}
        </button>
      </div>
    </div>
  ) : (
    <button type="button" className="inline-flex items-center gap-1 text-sm text-accent underline" onClick={() => setExplain(true)}>
      <MapPin size={14} aria-hidden /> {t("geo.find")}
    </button>
  );
}
