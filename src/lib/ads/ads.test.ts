import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sgtInstant } from "../time";
import { rng } from "../sandbox/generator";
import { adsTxtLine, adSenseScripts, adSenseSlotFor, cleanAdSense } from "./adsense";
import { thirdPartyScripts } from "../analytics/scripts";
import { ThirdPartyScripts } from "@/components/analytics/third-party-scripts";
import { validImageData, withAdUtm } from "./formats";
import { parseCampaignForm, parseCreativeForm } from "./admin-input";
import { FREQUENCY_CAP, eligibleCampaigns, matchesTargeting, selectCreative, spendSgd, type Delivery, type ServeCampaign, type ServeContext, type ServeCreative } from "./select";
import { GET as adsTxt } from "@/app/ads.txt/route";

// 2026-11-03 is a Tuesday.
const at = (clock: string, date = "2026-11-03") => sgtInstant(date, clock);
const NOW = at("13:00");
const camp = (over: Partial<ServeCampaign> & { id: number }): ServeCampaign => ({
  slug: `c${over.id}`,
  status: "active",
  startAt: at("00:00", "2026-11-01"),
  endAt: null,
  dailyBudgetSgd: 5,
  bidModel: "cpm",
  bidAmountSgd: 4,
  targeting: {},
  ...over,
});
const cr = (id: number, campaignId: number, weight = 1, format: ServeCreative["format"] = "meta_feed"): ServeCreative => ({ id, campaignId, format, weight, status: "active" });
const ctx = (over: Partial<ServeContext> = {}): ServeContext => ({ placement: "station", station: "tiong-bahru", lines: ["EWL"], language: "en", device: "mobile", now: NOW, ...over });
const none: Delivery = { today: {}, session: {} };

describe("house ad selection", () => {
  it("matches contextual targeting (station, line, language, time band, device)", () => {
    expect(matchesTargeting({}, ctx())).toBe(true);
    expect(matchesTargeting({ stations: ["outram-park"] }, ctx())).toBe(false);
    expect(matchesTargeting({ stations: ["tiong-bahru"], lines: ["EWL"] }, ctx())).toBe(true);
    expect(matchesTargeting({ lines: ["TEL"] }, ctx())).toBe(false);
    expect(matchesTargeting({ languages: ["zh-Hant"] }, ctx())).toBe(false);
    expect(matchesTargeting({ languages: ["zh-Hant"] }, ctx({ language: "zh-Hant" }))).toBe(true);
    expect(matchesTargeting({ timeBands: ["weekday_am_peak"] }, ctx())).toBe(false);
    expect(matchesTargeting({ timeBands: ["weekday_am_peak"] }, ctx({ now: at("08:00") }))).toBe(true);
    expect(matchesTargeting({ timeBands: ["weekend"] }, ctx({ now: at("13:00", "2026-11-07") }))).toBe(true);
    expect(matchesTargeting({ devices: ["desktop"] }, ctx())).toBe(false);
    // Paused, not started, ended → not eligible.
    const c = [camp({ id: 1, status: "paused" }), camp({ id: 2, startAt: at("14:00") }), camp({ id: 3, endAt: at("12:00") }), camp({ id: 4 })];
    expect(eligibleCampaigns(c, [1, 2, 3, 4].map((i) => cr(i, i)), ctx(), none).map((x) => x.id)).toEqual([4]);
  });

  it("stops a campaign once simulated spend reaches its daily budget (CPM and CPC)", () => {
    const cpm = camp({ id: 1, bidModel: "cpm", bidAmountSgd: 4, dailyBudgetSgd: 5 }); // 1,250 impressions
    const cpc = camp({ id: 2, bidModel: "cpc", bidAmountSgd: 0.5, dailyBudgetSgd: 2 }); // 4 clicks
    const creatives = [cr(1, 1), cr(2, 2)];
    expect(spendSgd("cpm", 4, 1250, 9)).toBe(5);
    expect(spendSgd("cpc", 0.5, 9999, 4)).toBe(2);
    const under: Delivery = { today: { 1: { impressions: 1249, clicks: 0 }, 2: { impressions: 500, clicks: 3 } }, session: {} };
    expect(eligibleCampaigns([cpm, cpc], creatives, ctx(), under).map((c) => c.id)).toEqual([1, 2]);
    const spent: Delivery = { today: { 1: { impressions: 1250, clicks: 0 }, 2: { impressions: 500, clicks: 4 } }, session: {} };
    expect(eligibleCampaigns([cpm, cpc], creatives, ctx(), spent)).toEqual([]);
    expect(selectCreative([cpm, cpc], creatives, ctx(), spent)).toBeNull();
  });

  it("caps each campaign at 3 impressions per session", () => {
    const c = [camp({ id: 1 }), camp({ id: 2 })];
    const creatives = [cr(1, 1), cr(2, 2)];
    expect(FREQUENCY_CAP).toBe(3);
    const d: Delivery = { today: {}, session: { 1: 3, 2: 2 } };
    for (let i = 0; i < 20; i++) expect(selectCreative(c, creatives, ctx(), d)?.campaign.id).toBe(2);
    expect(selectCreative(c, creatives, ctx(), { today: {}, session: { 1: 3, 2: 3 } })).toBeNull();
  });

  it("rotates creatives by A/B weight within the campaign", () => {
    const c = [camp({ id: 1 })];
    const creatives = [cr(10, 1, 3), cr(11, 1, 1), cr(12, 1, 0)];
    const rand = rng(42);
    const counts: Record<number, number> = { 10: 0, 11: 0, 12: 0 };
    for (let i = 0; i < 4000; i++) counts[selectCreative(c, creatives, ctx(), none, rand)!.creative.id]++;
    expect(counts[12]).toBe(0);
    expect(counts[10] / 4000).toBeGreaterThan(0.71);
    expect(counts[10] / 4000).toBeLessThan(0.79);
  });

  it("only serves formats the slot accepts", () => {
    const c = [camp({ id: 1 })];
    const creatives = [cr(1, 1, 1, "meta_story"), cr(2, 1, 1, "google_search_text")];
    for (let i = 0; i < 10; i++) expect(selectCreative(c, creatives, ctx({ formats: ["google_search_text"] }), none)?.creative.id).toBe(2);
  });

  it("appends UTM to destinations and refuses non-http schemes", () => {
    const url = withAdUtm("/accuracy?x=1&utm_source=evil", { format: "google_search_text", campaignSlug: "accuracy-report", creativeId: 7 }, "https://mrt.example");
    const u = new URL(url!);
    expect(u.origin + u.pathname).toBe("https://mrt.example/accuracy");
    expect(Object.fromEntries(u.searchParams)).toEqual({ x: "1", utm_source: "mrt_house", utm_medium: "google_search_text", utm_campaign: "accuracy-report", utm_content: "7" });
    expect(withAdUtm("javascript:alert(1)", { format: "meta_feed", campaignSlug: "x", creativeId: 1 }, "https://mrt.example")).toBeNull();
  });
});

describe("AdSense", () => {
  const CLIENT = "ca-pub-1234567890123456";
  const saved = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
    else process.env.NEXT_PUBLIC_ADSENSE_CLIENT = saved;
  });

  it("/ads.txt returns the seller line with env and 404 without", async () => {
    process.env.NEXT_PUBLIC_ADSENSE_CLIENT = CLIENT;
    const ok = adsTxt();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await ok.text()).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
    delete process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
    expect(adsTxt().status).toBe(404);
    process.env.NEXT_PUBLIC_ADSENSE_CLIENT = "ca-pub-<script>";
    expect(adsTxt().status).toBe(404);
    expect(adsTxtLine("pub-123")).toBeNull();
  });

  it("never renders the AdSense script when consent is denied", () => {
    const ids = { adsenseClient: CLIENT };
    expect(adSenseScripts({ analytics: false, marketing: false }, CLIENT)).toEqual([]);
    expect(thirdPartyScripts({ analytics: false, marketing: false }, ids)).toEqual([]);
    const html = renderToStaticMarkup(createElement(ThirdPartyScripts, { consent: { analytics: false, marketing: false }, ids }));
    expect(html).toBe("");
    expect(html).not.toMatch(/adsbygoogle|googlesyndication/);
    expect(adSenseSlotFor(cleanAdSense({ client: CLIENT, station: "1234567890" }), "station", { analytics: false, marketing: false }, false)).toBeNull();
  });

  it("is personalised only with marketing consent, non-personalised otherwise, and never for internal traffic", () => {
    const personalised = adSenseScripts({ analytics: true, marketing: true }, CLIENT);
    expect(personalised.map((s) => s.id)).toEqual(["adsense"]);
    expect(personalised[0].src).toBe(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`);
    const npa = adSenseScripts({ analytics: true, marketing: false }, CLIENT);
    expect(npa.map((s) => s.id)).toEqual(["adsense-npa", "adsense"]);
    expect(npa[0].inline).toContain("requestNonPersonalizedAds=1");
    expect(adSenseScripts({ analytics: true, marketing: true }, CLIENT, { internal: true })).toEqual([]);
    expect(thirdPartyScripts({ analytics: true, marketing: false }, { adsenseClient: CLIENT }).map((s) => s.id)).toEqual(["adsense-npa", "adsense"]);
    const cfg = cleanAdSense({ client: CLIENT, station: "1234567890", planner: "nope" });
    expect(cfg?.slots).toEqual({ station: "1234567890" });
    expect(adSenseSlotFor(cfg, "station", { analytics: true, marketing: false }, false)).toBe("1234567890");
    expect(adSenseSlotFor(cfg, "station_sponsored", { analytics: true, marketing: true }, false)).toBeNull();
    expect(adSenseSlotFor(cfg, "station", { analytics: true, marketing: true }, true)).toBeNull();
  });
});

describe("ad admin forms", () => {
  const form = (entries: [string, string][]) => {
    const fd = new FormData();
    for (const [k, v] of entries) fd.append(k, v);
    return fd;
  };
  it("parses a campaign with targeting and an inclusive end date", () => {
    const parsed = parseCampaignForm(
      form([
        ["name", "Install MRT Time"], ["slug", "install-mrt-time"], ["advertiser", "MRT Time"], ["objective", "conversion"], ["status", "active"],
        ["start", "2026-11-03"], ["end", "2026-11-30"], ["dailyBudgetSgd", "5"], ["bidModel", "cpm"], ["bidAmountSgd", "4"],
        ["lines", "EWL"], ["lines", "BOGUS"], ["devices", "mobile"], ["stations", "tiong-bahru"],
      ]),
    )!;
    expect(parsed.values.targeting).toEqual({ stations: ["tiong-bahru"], lines: ["EWL"], devices: ["mobile"] });
    expect(parsed.values.endAt!.toISOString()).toBe("2026-11-30T16:00:00.000Z");
    expect(parseCampaignForm(form([["slug", "Bad Slug!"]]))).toBeNull();
  });
  it("accepts a ≤200 KB data-URL image and rejects larger or non-image data", () => {
    const small = `data:image/png;base64,${"A".repeat(1000)}`;
    const big = `data:image/png;base64,${"A".repeat(300_000)}`;
    expect(validImageData(small)).toBe(true);
    expect(validImageData(big)).toBe(false);
    expect(validImageData("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    const base: [string, string][] = [["campaignId", "1"], ["format", "meta_feed"], ["headline", "Hi"], ["ctaLabel", "Go"], ["destinationUrl", "/accuracy"]];
    expect(parseCreativeForm(form([...base, ["imageData", small]]))?.values.imageData).toBe(small);
    expect(parseCreativeForm(form([...base, ["imageData", big]]))).toBeNull();
    expect(parseCreativeForm(form([...base.slice(0, 4), ["destinationUrl", "javascript:alert(1)"]]))).toBeNull();
  });
});
