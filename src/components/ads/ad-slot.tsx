"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { adSenseFromEnv, adSenseSlotFor } from "@/lib/ads/adsense";
import { SLOT_HEIGHT, type AdPlacement } from "@/lib/ads/formats";
import { flush, randomId, sessionId } from "@/lib/analytics/client";
import { useAnalytics } from "../analytics/analytics-provider";
import { useI18n } from "../i18n";
import { HouseAd, type HouseAdData } from "./house-ad";

const ADSENSE = adSenseFromEnv();
/** How long AdSense gets to fill before house ads take the slot. */
const ADSENSE_FILL_MS = 2500;
const VIEWABLE_MS = 1000;

type Served = HouseAdData & { campaign: string; campaignId: number };
type Mode = { kind: "waiting" } | { kind: "adsense"; slot: string } | { kind: "house"; ad: Served } | { kind: "none" };

/** Ad session: the analytics session with consent (so post-click conversions join), else a tab-only id. */
function adSession(consented: boolean): string {
  const s = consented ? sessionId(true).id : null;
  if (s) return s;
  let id = sessionStorage.getItem("mrt_ad_session");
  if (!id || !/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
    id = randomId();
    sessionStorage.setItem("mrt_ad_session", id);
  }
  return id;
}

type W = Window & { adsbygoogle?: unknown[] };

/**
 * A reserved-height ad slot (no layout shift). Loads only when near the
 * viewport. AdSense first where configured and consented; house ads fill
 * whatever AdSense leaves unfilled and the dedicated "Sponsored" slot.
 */
export function AdSlot({ placement, station, className = "" }: { placement: AdPlacement; station?: string; className?: string }) {
  const { t, locale, href } = useI18n();
  const { consent, userType, track, deviceId } = useAnalytics();
  const box = useRef<HTMLDivElement>(null);
  const ins = useRef<HTMLModElement>(null);
  const [near, setNear] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "waiting" });
  const [adsenseMissed, setAdsenseMissed] = useState(false);
  const height = SLOT_HEIGHT[placement];
  const internal = userType !== "visitor";

  // Lazy: start when within ~1.5 screens of the viewport.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = setTimeout(() => setNear(true), 0);
      return () => clearTimeout(id);
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Decide AdSense vs house once near.
  useEffect(() => {
    if (!near || mode.kind !== "waiting") return;
    const slot = consent.decided && !adsenseMissed ? adSenseSlotFor(ADSENSE, placement, consent, internal) : null;
    let stopped = false;
    const house = async () => {
      const q = new URLSearchParams({ p: placement, lang: locale, s: adSession(consent.analytics) });
      if (station) q.set("station", station);
      const res = await fetch(`/api/ads/serve?${q}`, { cache: "no-store" }).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as { ad: Served | null } | null) : null;
      if (!stopped) setMode(body?.ad ? { kind: "house", ad: body.ad } : { kind: "none" });
    };
    const id = setTimeout(() => {
      if (slot) setMode({ kind: "adsense", slot });
      else void house();
    }, 0);
    return () => {
      stopped = true;
      clearTimeout(id);
    };
  }, [near, mode.kind, consent, internal, placement, station, locale, adsenseMissed]);

  // AdSense: request the ad, fall back to house if it doesn't fill.
  const adsenseSlot = mode.kind === "adsense" ? mode.slot : null;
  useEffect(() => {
    if (!adsenseSlot) return;
    try {
      const w = window as W;
      (w.adsbygoogle = w.adsbygoogle || []).push({});
    } catch {}
    const id = setTimeout(() => {
      if (ins.current?.getAttribute("data-ad-status") !== "filled") {
        setAdsenseMissed(true);
        setMode({ kind: "waiting" });
      }
    }, ADSENSE_FILL_MS);
    return () => clearTimeout(id);
  }, [adsenseSlot]);

  const ad = mode.kind === "house" ? mode.ad : null;
  const params = ad ? { creative_id: ad.id, format: ad.format, placement, campaign: ad.campaign } : null;
  const post = (type: "impression" | "viewable", id: number) =>
    fetch("/api/ads/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, creativeId: id, placement, sessionId: adSession(consent.analytics), deviceId: deviceId() }),
      keepalive: true,
    }).catch(() => null);

  // Impression on render; viewable at ≥ 50 % for ≥ 1 s.
  const adId = ad?.id;
  useEffect(() => {
    if (!adId || !params) return;
    void post("impression", adId);
    track("ad_impression", params);
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (done) return;
        if (e.intersectionRatio >= 0.5) {
          timer ??= setTimeout(() => {
            done = true;
            void post("viewable", adId);
            track("ad_viewable", params);
            io.disconnect();
          }, VIEWABLE_MS);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per served creative
  }, [adId]);

  return (
    <aside
      ref={box}
      aria-label={t("ads.label")}
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ height, contain: "layout paint" }}
      data-ad-placement={placement}
    >
      {mode.kind === "adsense" && (
        <ins
          ref={ins}
          className="adsbygoogle"
          style={{ display: "block", width: "100%", height }}
          data-ad-client={ADSENSE?.client}
          data-ad-slot={mode.slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      )}
      {ad && <HouseAd ad={ad} locale={locale} onClick={() => (track("ad_click", params!), flush())} />}
      {mode.kind === "none" && (
        <Link href={href("/media-kit")} className="panel flex h-full w-full max-w-sm flex-col items-center justify-center gap-1 p-4 text-center text-sm text-muted">
          <span className="text-[10px] tracking-wide uppercase">{t("ads.label")}</span>
          <span className="font-semibold text-ink">{t("ads.yourAdHere")}</span>
          <span>{t("ads.mediaKit")}</span>
        </Link>
      )}
    </aside>
  );
}
