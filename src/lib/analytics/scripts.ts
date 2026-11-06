/**
 * Third-party tags, built only for granted consent (Consent Mode v2
 * "basic": nothing Google/Meta/Clarity loads before consent). IDs are
 * validated so env values can never inject script.
 */
import { consentModeSignals, type Consent } from "./consent";
import { adSenseScripts } from "../ads/adsense";

export type TagIds = {
  gtmId?: string;
  gaId?: string;
  adsId?: string;
  metaPixelId?: string;
  clarityId?: string;
  /** AdSense publisher client, ca-pub-… */
  adsenseClient?: string;
};
export type ScriptDescriptor = { id: string; src?: string; inline?: string };

const PATTERNS: Record<keyof TagIds, RegExp> = {
  gtmId: /^GTM-[A-Z0-9]{4,12}$/,
  gaId: /^G-[A-Z0-9]{4,16}$/,
  adsId: /^AW-\d{5,15}$/,
  metaPixelId: /^\d{8,20}$/,
  clarityId: /^[a-z0-9]{6,16}$/,
  adsenseClient: /^ca-pub-\d{10,20}$/,
};

export function cleanIds(ids: TagIds): TagIds {
  const out: TagIds = {};
  for (const key of Object.keys(PATTERNS) as (keyof TagIds)[]) {
    const value = ids[key]?.trim();
    if (value && PATTERNS[key].test(value)) out[key] = value;
  }
  return out;
}

/** Public tag IDs from env (inlined at build). */
export function tagIdsFromEnv(): TagIds {
  return cleanIds({
    gtmId: process.env.NEXT_PUBLIC_GTM_ID,
    gaId: process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
    adsId: process.env.NEXT_PUBLIC_GOOGLE_ADS_ID,
    metaPixelId: process.env.NEXT_PUBLIC_META_PIXEL_ID,
    clarityId: process.env.NEXT_PUBLIC_CLARITY_ID,
    adsenseClient: process.env.NEXT_PUBLIC_ADSENSE_CLIENT,
  });
}

export function thirdPartyScripts(
  consent: Pick<Consent, "analytics" | "marketing">,
  rawIds: TagIds,
  context: { internal?: boolean } = {},
): ScriptDescriptor[] {
  const ids = cleanIds(rawIds);
  if (!consent.analytics && !consent.marketing) return [];
  const out: ScriptDescriptor[] = [];
  const signals = JSON.stringify(consentModeSignals(consent));
  const google = Boolean(ids.gtmId || (ids.gaId && consent.analytics) || (ids.adsId && consent.marketing));
  if (google)
    out.push({
      id: "consent-defaults",
      inline:
        `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
        `gtag('consent','default',${JSON.stringify(consentModeSignals({ analytics: false, marketing: false }))});` +
        `gtag('consent','update',${signals});` +
        (context.internal ? `dataLayer.push({traffic_type:'internal'});` : ""),
    });
  if (ids.gtmId) {
    out.push({
      id: "gtm",
      inline:
        `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});` +
        `var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;` +
        `j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})` +
        `(window,document,'script','dataLayer','${ids.gtmId}');`,
    });
  } else if ((ids.gaId && consent.analytics) || (ids.adsId && consent.marketing)) {
    const primary = (consent.analytics && ids.gaId) || ids.adsId!;
    out.push({ id: "gtag-src", src: `https://www.googletagmanager.com/gtag/js?id=${primary}` });
    let config = "gtag('js',new Date());";
    if (ids.gaId && consent.analytics)
      config += `gtag('config','${ids.gaId}',{send_page_view:false${context.internal ? ",traffic_type:'internal'" : ""}});`;
    if (ids.adsId && consent.marketing) config += `gtag('config','${ids.adsId}');`;
    out.push({ id: "gtag-config", inline: config });
  }
  if (ids.metaPixelId && consent.marketing)
    out.push({
      id: "meta-pixel",
      inline:
        `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};` +
        `if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
        `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',` +
        `'https://connect.facebook.net/en_US/fbevents.js');fbq('set','autoConfig',false,'${ids.metaPixelId}');fbq('init','${ids.metaPixelId}');`,
    });
  if (ids.clarityId && consent.analytics)
    out.push({
      id: "clarity",
      inline:
        `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};` +
        `t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];` +
        `y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${ids.clarityId}");`,
    });
  // AdSense: any consent loads it; non-personalised unless marketing consent.
  out.push(...adSenseScripts(consent, ids.adsenseClient, context));
  return out;
}
