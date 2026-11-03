/** UTM capture and campaign link building. */
export type Utm = { source?: string; medium?: string; campaign?: string; content?: string; term?: string };

const TOKEN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** Normalise a UTM value to a safe slug ("Spring Promo!" → "spring-promo"). */
export function utmToken(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return TOKEN.test(slug) ? slug : undefined;
}

export function utmFromSearch(search: URLSearchParams | string): Utm | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const utm: Utm = {
    source: utmToken(params.get("utm_source")),
    medium: utmToken(params.get("utm_medium")),
    campaign: utmToken(params.get("utm_campaign")),
    content: utmToken(params.get("utm_content")),
    term: utmToken(params.get("utm_term")),
  };
  const clean = Object.fromEntries(Object.entries(utm).filter(([, v]) => v)) as Utm;
  return clean.source || clean.medium || clean.campaign ? clean : null;
}

export type CampaignInput = {
  baseUrl: string;
  landingPath: string;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
  campaignId?: string;
};

/** A landing URL with UTM parameters (values slugged). */
export function buildCampaignUrl(input: CampaignInput): string {
  const url = new URL(input.landingPath.startsWith("/") ? input.landingPath : `/${input.landingPath}`, input.baseUrl);
  const set = (key: string, value?: string) => {
    const token = utmToken(value);
    if (token) url.searchParams.set(key, token);
  };
  set("utm_source", input.source);
  set("utm_medium", input.medium);
  set("utm_campaign", input.campaign);
  set("utm_content", input.content);
  set("utm_term", input.term);
  set("utm_id", input.campaignId);
  return url.toString();
}

/** UTM auto-applied on /k/[handle] landings. */
export function kolUtm(handle: string, campaign = "kol"): Utm {
  return { source: utmToken(handle), medium: "kol", campaign: utmToken(campaign) };
}

/** Share link with UTM so shares are attributable. */
export function shareUrl(baseUrl: string, path: string, contentType: string) {
  return buildCampaignUrl({ baseUrl, landingPath: path, source: "share", medium: "referral", campaign: "web-share", content: contentType });
}
