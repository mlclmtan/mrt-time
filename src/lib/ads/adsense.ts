/**
 * Google AdSense (publisher side). Every value comes from env and is
 * validated so it can never inject markup. Without
 * NEXT_PUBLIC_ADSENSE_CLIENT nothing loads, /ads.txt is 404 and every slot
 * falls back to house ads.
 */
import type { AdPlacement } from "./formats";

export type AdSenseConfig = { client: string; slots: Partial<Record<AdPlacement, string>> };

const CLIENT = /^ca-pub-\d{10,20}$/;
const SLOT = /^\d{6,12}$/;

export function cleanAdSense(raw: { client?: string; station?: string; planner?: string; landing?: string }): AdSenseConfig | null {
  const client = raw.client?.trim();
  if (!client || !CLIENT.test(client)) return null;
  const slots: AdSenseConfig["slots"] = {};
  for (const key of ["station", "planner", "landing"] as const) {
    const v = raw[key]?.trim();
    if (v && SLOT.test(v)) slots[key] = v;
  }
  return { client, slots };
}

/** Public ids from env (NEXT_PUBLIC_* are inlined at build time). */
export function adSenseFromEnv(): AdSenseConfig | null {
  return cleanAdSense({
    client: process.env.NEXT_PUBLIC_ADSENSE_CLIENT,
    station: process.env.NEXT_PUBLIC_ADSENSE_SLOT_STATION,
    planner: process.env.NEXT_PUBLIC_ADSENSE_SLOT_PLANNER,
    landing: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LANDING,
  });
}

/** Google's certification authority id for AdSense in ads.txt. */
export const GOOGLE_ADS_TXT_CERT = "f08c47fec0942fa0";

/** "google.com, pub-123…, DIRECT, f08c47fec0942fa0" or null when unset/invalid. */
export function adsTxtLine(client: string | undefined): string | null {
  const cfg = cleanAdSense({ client });
  if (!cfg) return null;
  return `google.com, ${cfg.client.replace(/^ca-/, "")}, DIRECT, ${GOOGLE_ADS_TXT_CERT}`;
}

export type AdSenseScript = { id: string; src?: string; inline?: string };

/**
 * Consent Mode v2 basic: nothing loads until consent. Any consent loads the
 * library; without marketing consent ads are non-personalised
 * (requestNonPersonalizedAds=1, set before the library runs). Internal
 * (owner/analyst) traffic never loads AdSense — clicks on your own ads are
 * invalid traffic under AdSense policy.
 */
export function adSenseScripts(
  consent: { analytics: boolean; marketing: boolean },
  client: string | undefined,
  context: { internal?: boolean } = {},
): AdSenseScript[] {
  const cfg = cleanAdSense({ client });
  if (!cfg || context.internal) return [];
  if (!consent.analytics && !consent.marketing) return [];
  const out: AdSenseScript[] = [];
  if (!consent.marketing) out.push({ id: "adsense-npa", inline: "(window.adsbygoogle=window.adsbygoogle||[]).requestNonPersonalizedAds=1;" });
  out.push({ id: "adsense", src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${cfg.client}` });
  return out;
}

/** Whether a slot should try AdSense before house ads. */
export function adSenseSlotFor(cfg: AdSenseConfig | null, placement: AdPlacement, consent: { analytics: boolean; marketing: boolean }, internal: boolean): string | null {
  if (!cfg || internal || (!consent.analytics && !consent.marketing)) return null;
  return cfg.slots[placement] ?? null;
}
