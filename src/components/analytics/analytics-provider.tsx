"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { onCLS, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { validateEvent, type EventName, type EventProps } from "@/lib/analytics/events";
import { consentModeSignals, type Consent } from "@/lib/analytics/consent";
import { GA4_DIMENSIONS, ga4Params, metaEventFor, privacyProps, type UserType } from "@/lib/analytics/mapping";
import { tagIdsFromEnv } from "@/lib/analytics/scripts";
import { utmFromSearch, type Utm } from "@/lib/analytics/utm";
import { pageTypeFor } from "@/lib/analytics/page-type";
import { splitLocale, type Locale } from "@/lib/i18n";
import {
  cookieValue,
  deviceId,
  flush,
  isStandalone,
  randomId,
  readConsent,
  rememberKol,
  rememberUtm,
  send,
  sessionId,
  writeConsent,
} from "@/lib/analytics/client";
import { ThirdPartyScripts } from "./third-party-scripts";

type Track = <N extends EventName>(name: N, props: EventProps<N>) => void;
type Ctx = {
  consent: Consent;
  setConsent: (c: { analytics: boolean; marketing: boolean }) => void;
  track: Track;
  locale: Locale;
  userType: UserType;
  experiments: Record<string, string>;
  deviceId: () => string | null;
};

const AnalyticsContext = createContext<Ctx | null>(null);

type W = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
};

const IDS = tagIdsFromEnv();

export function AnalyticsProvider({
  children,
  locale,
  userType,
  experiments,
}: {
  children: React.ReactNode;
  locale: Locale;
  userType: UserType;
  experiments: Record<string, string>;
}) {
  const [consent, setConsentState] = useState<Consent>({ analytics: false, marketing: false, decided: true });
  const utm = useRef<Utm | null>(null);
  const kol = useRef<string | null>(null);
  const consentRef = useRef(consent);

  useEffect(() => {
    const c = readConsent();
    consentRef.current = c;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consent lives in a cookie only the browser reads
    setConsentState(c);
  }, []);

  const track = useCallback<Track>(
    (name, props) => {
      const c = consentRef.current;
      // Visitors: no station on boarded / got off / GPS events (never station + device together).
      const checked = validateEvent(name, privacyProps(name, props as Record<string, unknown>, userType) as EventProps<typeof name>);
      if (!checked.ok) return;
      const any = c.analytics || c.marketing;
      if (!any) return; // the proxy counts anonymous page hits server-side
      const eventId = randomId();
      const route = `${location.pathname}`;
      const standalone = isStandalone();
      const kolHandle = rememberKol(kol.current, c.analytics);
      send({
        name,
        props: checked.props,
        event_id: eventId,
        device_id: deviceId(c.analytics),
        session_id: sessionId(c.analytics).id,
        route,
        referrer: document.referrer || null,
        utm: utm.current,
        kol_handle: kolHandle,
        viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
        standalone,
        language: locale,
        experiments,
        consent: { analytics: c.analytics, marketing: c.marketing },
        fbp: cookieValue("_fbp"),
        fbc: cookieValue("_fbc"),
      });
      const w = window as W;
      const params = ga4Params(name, checked.props, { language: locale, standalone, userType, experiments, kolHandle, campaign: utm.current?.campaign });
      if (c.analytics || c.marketing) {
        // Reset every dimension so values never carry over between GTM events.
        const cleared = Object.fromEntries(GA4_DIMENSIONS.map((d) => [d, undefined]));
        if (IDS.gtmId) w.dataLayer?.push({ ...cleared, event: name, ...params });
        else w.gtag?.("event", name, params);
      }
      // Owner/analyst traffic never goes to ad platforms.
      const meta = c.marketing && userType === "visitor" ? metaEventFor(name, checked.props) : null;
      if (meta && w.fbq) w.fbq(meta.custom ? "trackCustom" : "track", meta.event, meta.data, { eventID: eventId });
    },
    [experiments, locale, userType],
  );

  const setConsent = useCallback(
    (next: { analytics: boolean; marketing: boolean }) => {
      writeConsent(next);
      const c = { ...next, decided: true };
      consentRef.current = c;
      setConsentState(c);
      (window as W).gtag?.("consent", "update", consentModeSignals(next));
      track("consent_update", next);
    },
    [track],
  );

  // UTM / KOL capture and page views on navigation.
  const pathname = usePathname();
  useEffect(() => {
    const c = consentRef.current;
    const fromUrl = utmFromSearch(location.search);
    utm.current = rememberUtm(fromUrl, c.analytics) ?? utm.current;
    const { path } = splitLocale(pathname);
    const k = /^\/k\/([a-z0-9_-]+)/i.exec(path);
    if (k) kol.current = k[1].toLowerCase();
    const station = /^\/station\/([a-z0-9-]+)/.exec(path)?.[1];
    track("page_view", { page_type: pageTypeFor(path, userType), ...(station ? { station } : {}) });
    if (fromUrl?.campaign && fromUrl.source && fromUrl.medium && fromUrl.medium !== "kol")
      track("campaign_landing", { campaign: fromUrl.campaign, source: fromUrl.source, medium: fromUrl.medium });
  }, [pathname, consent.analytics, consent.marketing, track, userType]);

  // Web vitals, standalone opens and installs (once per page load).
  useEffect(() => {
    const report = (m: Metric) =>
      track("web_vital", { metric: m.name as "LCP", value: Math.round(m.value * 1000) / 1000, rating: m.rating });
    onLCP(report);
    onINP(report);
    onCLS(report);
    onTTFB(report);
    if (isStandalone() && !sessionStorage.getItem("mrt_standalone")) {
      sessionStorage.setItem("mrt_standalone", "1");
      track("standalone_open", {});
    }
    const installed = () => track("app_installed", { platform: /iphone|ipad/i.test(navigator.userAgent) ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "desktop" });
    window.addEventListener("appinstalled", installed);
    const hide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("appinstalled", installed);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [track]);

  const value = useMemo<Ctx>(
    () => ({ consent, setConsent, track, locale, userType, experiments, deviceId: () => deviceId(consentRef.current.analytics) }),
    [consent, setConsent, track, locale, userType, experiments],
  );
  const internal = userType !== "visitor";
  return (
    <AnalyticsContext.Provider value={value}>
      {children}
      {consent.decided && <ThirdPartyScripts consent={consent} ids={IDS} internal={internal} />}
    </AnalyticsContext.Provider>
  );
}

/** Outside the provider (isolated renders/tests) tracking is a no-op and consent is denied. */
const NO_ANALYTICS: Ctx = {
  consent: { analytics: false, marketing: false, decided: false },
  setConsent: () => {},
  track: () => {},
  locale: "en",
  userType: "visitor",
  experiments: {},
  deviceId: () => null,
};

export function useAnalytics(): Ctx {
  return useContext(AnalyticsContext) ?? NO_ANALYTICS;
}
