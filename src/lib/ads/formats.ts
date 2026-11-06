/**
 * House-ad vocabulary shared by serving, rendering, admin and analytics.
 * Meta Audience Network doesn't serve mobile-web ads, so Meta-style units
 * (feed card, story) are simulated in-house next to Google-style ones.
 */
export const AD_FORMATS = ["meta_feed", "meta_story", "google_display", "google_search_text"] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

/** Where slots exist. Never on owner Home, admin, /add, settings or sign-in. */
export const AD_PLACEMENTS = ["station", "station_sponsored", "planner", "landing"] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export const AD_OBJECTIVES = ["awareness", "traffic", "conversion"] as const;
export const AD_BID_MODELS = ["cpm", "cpc"] as const;
export type BidModel = (typeof AD_BID_MODELS)[number];
export const AD_DEVICES = ["mobile", "tablet", "desktop"] as const;
export const AD_TIME_BANDS = ["weekday_am_peak", "weekday_pm_peak", "weekday_offpeak", "weekend"] as const;
export const AD_EVENT_TYPES = ["impression", "viewable", "click"] as const;
export type AdEventType = (typeof AD_EVENT_TYPES)[number];

/** Reserved slot height (px) so nothing shifts when an ad fills (no CLS). */
export const SLOT_HEIGHT: Record<AdPlacement, number> = {
  station: 300,
  station_sponsored: 300,
  planner: 300,
  landing: 300,
};

/** AdSense is tried first in these; the dedicated "Sponsored" slot is house-only. */
export const ADSENSE_PLACEMENTS: AdPlacement[] = ["station", "planner", "landing"];

export const isAdFormat = (v: unknown): v is AdFormat => typeof v === "string" && (AD_FORMATS as readonly string[]).includes(v);
export const isAdPlacement = (v: unknown): v is AdPlacement => typeof v === "string" && (AD_PLACEMENTS as readonly string[]).includes(v);

/**
 * Destination with UTM appended: utm_source=mrt_house, utm_medium=<format>,
 * utm_campaign=<campaign slug>, utm_content=<creative id>. Relative
 * destinations resolve against the app origin. Existing params are kept
 * except the UTM ones, which are always ours.
 */
export function withAdUtm(destination: string, ad: { format: AdFormat | string; campaignSlug: string; creativeId: number }, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(destination, origin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("utm_source", "mrt_house");
  url.searchParams.set("utm_medium", ad.format);
  url.searchParams.set("utm_campaign", ad.campaignSlug);
  url.searchParams.set("utm_content", String(ad.creativeId));
  return url.toString();
}

/** Hostname for search-style ads ("mrt.91208274.xyz"). */
export function displayHost(destination: string, origin: string) {
  try {
    return new URL(destination, origin).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const MAX_IMAGE_BYTES = 200 * 1024;
/** An uploaded image: a base64 data URL of a raster image, ≤ 200 KB decoded. */
export function validImageData(dataUrl: string | null | undefined): boolean {
  if (!dataUrl) return false;
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return false;
  const bytes = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith("==") ? 2 : m[2].endsWith("=") ? 1 : 0);
  return bytes <= MAX_IMAGE_BYTES;
}
