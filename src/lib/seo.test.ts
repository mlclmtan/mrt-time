import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/server", () => ({
  getLocale: async () => "en",
  getT: async () => {
    const { makeT } = await import("@/lib/i18n");
    return { locale: "en", t: makeT("en") };
  },
}));
vi.mock("@/lib/auth/server", () => ({ getSession: async () => null }));

import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import manifest from "@/app/manifest";
import { pageMetadata, stationJsonLd, websiteJsonLd, jsonLdString, DEFAULT_APP_URL } from "./seo";
import { getStation, STATIONS } from "./network";
import { localePath, makeT, splitLocale, translate } from "./i18n";
import { en, zhHant } from "./i18n/dict";

describe("landing SEO outputs", () => {
  it("landing page has title, description, canonical, hreflang and OG", async () => {
    const { generateMetadata } = await import("@/app/page");
    const meta = await generateMetadata();
    expect(meta.title).toMatch(/MRT Time/);
    expect(meta.description).toBeTruthy();
    expect(meta.alternates?.canonical).toBe("/");
    expect(meta.alternates?.languages).toMatchObject({ "en-SG": "/", "zh-Hant": "/zh-Hant" });
    expect(meta.openGraph).toMatchObject({ siteName: "MRT Time", url: "/" });
    expect(JSON.stringify(meta.openGraph)).toContain("/opengraph-image");
  });

  it("sitemap lists public pages and every station with zh-Hant alternates", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toContain(`${DEFAULT_APP_URL}/`);
    expect(urls).toContain(`${DEFAULT_APP_URL}/plan`);
    for (const s of STATIONS) expect(urls).toContain(`${DEFAULT_APP_URL}/station/${s.slug}`);
    expect(entries.find((e) => e.url.endsWith("/station/outram-park"))?.alternates?.languages).toMatchObject({
      "zh-Hant": `${DEFAULT_APP_URL}/zh-Hant/station/outram-park`,
    });
    expect(urls.some((u) => u.includes("/admin"))).toBe(false);
  });

  it("robots allows the site, blocks private areas and points at the sitemap", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/admin"]));
    expect(r.sitemap).toBe(`${DEFAULT_APP_URL}/sitemap.xml`);
  });

  it("JSON-LD for the site and stations is valid schema.org", () => {
    const site = websiteJsonLd("en");
    expect(site["@context"]).toBe("https://schema.org");
    expect(site["@graph"].map((g) => g["@type"])).toEqual(["WebSite", "WebApplication"]);
    const station = stationJsonLd(getStation("outram-park")!, "zh-Hant");
    const types = station["@graph"].map((g) => g["@type"]);
    expect(types).toEqual(["TrainStation", "FAQPage", "BreadcrumbList"]);
    expect(JSON.stringify(station)).toContain("歐南園");
    expect(jsonLdString({ x: "</script>" })).not.toContain("</script>");
  });

  it("OG image routes export size/contentType and render a PNG", async () => {
    const og = await import("@/app/opengraph-image");
    expect(og.size).toEqual({ width: 1200, height: 630 });
    expect(og.contentType).toBe("image/png");
    expect(og.alt).toMatch(/MRT Time/);
    const res = og.default();
    expect(res.headers.get("content-type")).toBe("image/png");
    const station = await import("@/app/station/[slug]/opengraph-image");
    expect(station.size).toEqual({ width: 1200, height: 630 });
  });

  it("PWA manifest is installable and standalone", () => {
    const m = manifest();
    expect(m.display).toBe("standalone");
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("per-page metadata can be noindex", () => {
    expect(pageMetadata({ locale: "en", path: "/x", title: "X", description: "Y", noindex: true }).robots).toEqual({ index: false, follow: false });
  });
});

describe("i18n", () => {
  it("every English key has a Traditional Chinese string", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) expect(zhHant[key], key).toBeTruthy();
  });
  it("interpolates and routes by locale prefix", () => {
    expect(translate("en", "board.every", { n: 5 })).toBe("Every ~5 min");
    expect(makeT("zh-Hant")("board.every", { n: 5 })).toBe("約每 5 分鐘一班");
    expect(localePath("zh-Hant", "/")).toBe("/zh-Hant");
    expect(localePath("zh-Hant", "/plan")).toBe("/zh-Hant/plan");
    expect(splitLocale("/zh-Hant/station/orchard")).toEqual({ locale: "zh-Hant", path: "/station/orchard" });
    expect(splitLocale("/zh-Hantx")).toEqual({ locale: null, path: "/zh-Hantx" });
    expect(splitLocale("/plan")).toEqual({ locale: null, path: "/plan" });
  });
});
