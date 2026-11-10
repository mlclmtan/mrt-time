import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { EVENT_NAMES, EVENT_SCHEMAS, cleanReferrer, cleanRoute, envelopeSchema, validateEvent } from "./events";
import { consentModeSignals, parseConsent, serializeConsent } from "./consent";
import { cleanIds, thirdPartyScripts } from "./scripts";
import { buildCampaignUrl, kolUtm, utmFromSearch, utmToken } from "./utm";
import { assignAll, assignVariant, significance, DEFAULT_EXPERIMENTS } from "./experiments";
import { ga4Params, metaEventFor, privacyProps } from "./mapping";
import { buildEventRow } from "./ingest";
import { capiPayload } from "./meta-capi";
import { coarseUa, dailyIpHash } from "./request";
import { ThirdPartyScripts } from "@/components/analytics/third-party-scripts";
import { clampToMpWindow, generateDay, MP_MAX_BACKDATE_MS } from "../sandbox/generator";
import { assertSandboxTarget, sendPayloads, SandboxTargetError } from "../sandbox/sender";
import { COST_COLUMNS, costCsv, recentDates } from "../sandbox/cost";

const IDS = { gtmId: "GTM-ABC1234", gaId: "G-PROD12345", adsId: "AW-1234567", metaPixelId: "123456789012", clarityId: "abcd1234" };

describe("event taxonomy", () => {
  it("covers every spec event name", () => {
    expect(EVENT_NAMES.sort()).toEqual(
      [
        "page_view", "station_view", "journey_view", "planner_query", "prediction_view", "prediction_feedback",
        "log_reading", "log_trip_event", "submit_reading", "install_prompt_shown", "app_installed", "standalone_open",
        "share", "outbound_click", "alert_view", "crowd_view", "feedback_submit", "nps_submit", "newsletter_signup",
        "experiment_exposure", "kol_landing", "campaign_landing", "consent_update", "web_vital",
        "ad_impression", "ad_viewable", "ad_click",
        // v2
        "boarded_logged", "alighted_logged", "timeline_edit", "stats_view", "geo_suggest_shown", "geo_suggest_accepted",
      ].sort(),
    );
  });

  it("no event schema has an email, name or free-text field", () => {
    const forbidden = /(^|_)(email|e_?mail|name|text|comment|message|note|address|phone|query|search|lat|lng|ip)(_|$)/i;
    const freeText = "Hello there, my email is someone@example.com";
    for (const name of EVENT_NAMES) {
      const shape = EVENT_SCHEMAS[name].shape as Record<string, unknown>;
      for (const key of Object.keys(shape)) {
        expect(key, `${name}.${key}`).not.toMatch(forbidden);
        // Any string-accepting field must reject sentences and email addresses.
        const probe = EVENT_SCHEMAS[name].safeParse({ [key]: freeText });
        const issues = probe.success ? [] : probe.error.issues.filter((i) => i.path[0] === key);
        expect(issues.length, `${name}.${key} accepted free text`).toBeGreaterThan(0);
      }
      // Unknown keys are rejected (strict objects).
      expect(EVENT_SCHEMAS[name].safeParse({ email: "a@b.c" }).success).toBe(false);
    }
  });

  it("validates props per event name", () => {
    expect(validateEvent("station_view", { station: "outram-park", line: "TEL" }).ok).toBe(true);
    expect(validateEvent("station_view", { station: "Outram Park" }).ok).toBe(false);
    expect(validateEvent("nps_submit", { score: 11 }).ok).toBe(false);
    expect(validateEvent("feedback_submit", { rating: 4, category: "bug", text: "hi" }).ok).toBe(false);
    expect(validateEvent("made_up", {}).ok).toBe(false);
    expect(validateEvent("web_vital", { metric: "LCP", value: 1234.5, rating: "good" }).ok).toBe(true);
  });

  it("strips query strings from routes and referrers", () => {
    expect(cleanRoute("/station/orchard?email=a@b.c#x")).toBe("/station/orchard");
    expect(cleanReferrer("https://www.google.com/search?q=secret")).toBe("https://www.google.com/search");
    expect(cleanReferrer("not a url")).toBeNull();
    expect(
      envelopeSchema.safeParse({
        name: "page_view",
        event_id: "abcdef12-3456",
        route: "/",
        consent: { analytics: false, marketing: false },
        utm: { source: "Has Spaces" },
      }).success,
    ).toBe(false);
  });
});

describe("consent and third-party scripts", () => {
  it("parses and serialises the consent cookie", () => {
    expect(parseConsent(serializeConsent({ analytics: true, marketing: false }, 1_700_000_000_000))).toMatchObject({
      analytics: true,
      marketing: false,
      decided: true,
    });
    expect(parseConsent("garbage")).toMatchObject({ analytics: false, marketing: false, decided: false });
    expect(consentModeSignals({ analytics: true, marketing: false })).toEqual({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
  });

  it("consent denied renders no third-party script tags", () => {
    expect(thirdPartyScripts({ analytics: false, marketing: false }, IDS)).toEqual([]);
    const html = renderToStaticMarkup(
      createElement(ThirdPartyScripts, { consent: { analytics: false, marketing: false }, ids: IDS }),
    );
    expect(html).toBe("");
    expect(html).not.toMatch(/googletagmanager|facebook|clarity/);
  });

  it("analytics consent loads GTM + Clarity but not the Meta pixel", () => {
    const scripts = thirdPartyScripts({ analytics: true, marketing: false }, IDS);
    const ids = scripts.map((s) => s.id);
    expect(ids).toEqual(["consent-defaults", "gtm", "clarity"]);
    expect(scripts[0].inline).toContain(`"ad_storage":"denied"`);
    expect(scripts.find((s) => s.id === "gtm")!.inline).toContain("googletagmanager.com/gtm.js");
    expect(scripts.map((s) => s.inline ?? s.src).join("")).not.toContain("fbevents");
  });

  it("marketing consent adds Meta; gtag fallback without GTM; internal traffic flagged", () => {
    expect(thirdPartyScripts({ analytics: false, marketing: true }, IDS).map((s) => s.id)).toEqual([
      "consent-defaults",
      "gtm",
      "meta-pixel",
    ]);
    const direct = thirdPartyScripts({ analytics: true, marketing: true }, { ...IDS, gtmId: undefined }, { internal: true });
    expect(direct.map((s) => s.id)).toEqual(["consent-defaults", "gtag-src", "gtag-config", "meta-pixel", "clarity"]);
    expect(direct.find((s) => s.id === "gtag-config")!.inline).toContain("traffic_type:'internal'");
    expect(direct.find((s) => s.id === "gtag-config")!.inline).toContain("send_page_view:false");
  });

  it("rejects IDs that could inject script", () => {
    expect(cleanIds({ gtmId: "GTM-X');alert(1);//", gaId: "G-OK12345" })).toEqual({ gaId: "G-OK12345" });
  });
});

describe("UTM, experiments, mapping", () => {
  it("captures and builds UTM links", () => {
    expect(utmFromSearch("?utm_source=TikTok&utm_medium=Paid Social&utm_campaign=Launch!")).toEqual({
      source: "tiktok",
      medium: "paid-social",
      campaign: "launch",
    });
    expect(utmFromSearch("?foo=1")).toBeNull();
    expect(utmToken("  ")).toBeUndefined();
    expect(
      buildCampaignUrl({ baseUrl: "https://mrt.example", landingPath: "/station/orchard", source: "meta", medium: "paid_social", campaign: "Reels Q4", campaignId: "m-1" }),
    ).toBe("https://mrt.example/station/orchard?utm_source=meta&utm_medium=paid_social&utm_campaign=reels-q4&utm_id=m-1");
    expect(kolUtm("TrainFan")).toEqual({ source: "trainfan", medium: "kol", campaign: "kol" });
  });

  it("assigns sticky, roughly weighted variants", () => {
    const exp = DEFAULT_EXPERIMENTS[0];
    expect(assignVariant("seed-1", exp)).toBe(assignVariant("seed-1", exp));
    let control = 0;
    for (let i = 0; i < 4000; i++) if (assignVariant(`s${i}`, exp) === "control") control++;
    expect(control / 4000).toBeGreaterThan(0.45);
    expect(control / 4000).toBeLessThan(0.55);
    expect(assignAll("x", [{ ...exp, active: false }])).toEqual({});
    expect(significance({ n: 1000, x: 100 }, { n: 1000, x: 150 }).p).toBeLessThan(0.01);
    expect(significance({ n: 10, x: 1 }, { n: 10, x: 2 }).note).toMatch(/Too early/);
  });

  it("maps to GA4 params with internal traffic and to Meta events", () => {
    const params = ga4Params("station_view", { station: "orchard" }, { userType: "owner", language: "en", standalone: true, experiments: { landing_hero: "control" } });
    expect(params).toMatchObject({ station: "orchard", traffic_type: "internal", user_type: "owner", standalone: "yes", experiment_id: "landing_hero", variant: "control" });
    expect(ga4Params("page_view", {}, { userType: "visitor" }).traffic_type).toBeUndefined();
    expect(metaEventFor("app_installed", {})?.event).toBe("CompleteRegistration");
    expect(metaEventFor("planner_query", { mode: "list" })).toMatchObject({ event: "PlanJourney", custom: true });
    expect(metaEventFor("prediction_view", {})).toBeNull();
    const body = capiPayload({ event: "Lead", custom: false, data: {} }, { eventId: "e1", eventTime: 1_700_000_000_000, url: "https://x/", userAgent: "UA", fbp: "fb.1.1.2" }, "TEST1");
    expect(body).toMatchObject({ test_event_code: "TEST1", data: [{ event_id: "e1", action_source: "website", user_data: { client_user_agent: "UA", fbp: "fb.1.1.2" } }] });
    expect(JSON.stringify(body)).not.toMatch(/client_ip_address|em"|ph"/);
  });

  it("visitors' boarded / got off / GPS events never carry the station with a device id, and never go to Meta (F9)", () => {
    const boarded = { station: "EW17", line: "EWL", direction: "TO_EAST", minutes_back: 0, user_type: "visitor", status: "approved" };
    expect(privacyProps("boarded_logged", boarded, "visitor")).not.toHaveProperty("station");
    expect(privacyProps("boarded_logged", boarded, "visitor")).toMatchObject({ line: "EWL", direction: "TO_EAST" });
    expect(privacyProps("alighted_logged", boarded, "visitor")).not.toHaveProperty("station");
    expect(privacyProps("geo_suggest_accepted", { station: "tiong-bahru", surface: "add" }, "visitor")).toEqual({ surface: "add" });
    // The owner (internal traffic) keeps it; other events are untouched.
    expect(privacyProps("boarded_logged", boarded, "owner")).toHaveProperty("station", "EW17");
    expect(privacyProps("station_view", { station: "orchard" }, "visitor")).toEqual({ station: "orchard" });
    for (const name of ["boarded_logged", "alighted_logged", "geo_suggest_shown", "geo_suggest_accepted"] as const) expect(metaEventFor(name, boarded)).toBeNull();
    // Still valid without the station, and the server-side ingest strips it too.
    expect(validateEvent("geo_suggest_shown", { surface: "home" }).ok).toBe(true);
    const row = buildEventRow(
      { name: "boarded_logged", props: boarded, event_id: "evt-12345678", device_id: "dev-12345678", consent: { analytics: true, marketing: true }, route: "/station/tiong-bahru" },
      { headers: new Headers({ "user-agent": "Mozilla/5.0 (iPhone)" }), userType: "visitor", now: Date.now(), origin: "https://x" },
    );
    expect(row.ok).toBe(true);
    if (row.ok) expect(row.row.props).not.toHaveProperty("station");
  });

  it("coarse UA and salted daily IP hash", () => {
    expect(coarseUa("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1")).toEqual({ browser: "Safari", os: "iOS", deviceType: "mobile" });
    const day1 = dailyIpHash("203.0.113.9", Date.parse("2026-11-02T02:00:00Z"), "salt");
    const day1b = dailyIpHash("203.0.113.9", Date.parse("2026-11-02T10:00:00Z"), "salt");
    const day2 = dailyIpHash("203.0.113.9", Date.parse("2026-11-03T02:00:00Z"), "salt");
    expect(day1).toBe(day1b);
    expect(day1).not.toBe(day2);
    expect(day1).not.toContain("203.0.113.9");
  });
});

describe("practice sandbox", () => {
  it("never targets the production measurement id", async () => {
    expect(() => assertSandboxTarget("G-PROD12345", ["G-PROD12345"])).toThrow(SandboxTargetError);
    expect(() => assertSandboxTarget("g-prod12345", ["G-PROD12345"])).toThrow(SandboxTargetError);
    expect(() => assertSandboxTarget(undefined, [])).toThrow(SandboxTargetError);
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const { payloads } = generateDay("2026-11-02");
    await expect(
      sendPayloads(payloads.slice(0, 3), { measurementId: "G-PROD12345", apiSecret: "s", production: ["G-PROD12345"], fetchImpl }),
    ).rejects.toThrow(SandboxTargetError);
    expect(called).toBe(0);
    const urls: string[] = [];
    const recording = (async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const result = await sendPayloads(payloads.slice(0, 3), { measurementId: "G-SANDBOX01", apiSecret: "s", production: ["G-PROD12345"], fetchImpl: recording });
    expect(result.requests).toBe(3);
    expect(urls.every((u) => u.includes("measurement_id=G-SANDBOX01") && !u.includes("G-PROD12345"))).toBe(true);
  });

  it("generates 200–600 labelled synthetic users per day within MP limits", () => {
    for (const date of ["2026-11-02", "2026-11-07"]) {
      const day = generateDay(date);
      expect(day.users).toBeGreaterThanOrEqual(200);
      expect(day.users).toBeLessThanOrEqual(600);
      for (const p of day.payloads) {
        expect(p.events.length).toBeLessThanOrEqual(25);
        for (const e of p.events) {
          expect(e.params.data_source).toBe("synthetic");
          expect(e.name).toMatch(/^[a-z_]{1,40}$/);
          expect(Object.keys(e.params).length).toBeLessThanOrEqual(25);
        }
      }
    }
    expect(generateDay("2026-11-02")).toEqual(generateDay("2026-11-02")); // deterministic
  });

  it("generates ad impressions/viewables/clicks with per-format CTR and AdSense-like ad_revenue", () => {
    const by: Record<string, { imp: number; click: number }> = {};
    let revenue = 0;
    for (const date of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"])
      for (const p of generateDay(date).payloads)
        for (const e of p.events) {
          if (!e.name.startsWith("ad_")) continue;
          expect(e.params.data_source).toBe("synthetic");
          const key = e.params.ad_source === "adsense" ? "adsense" : String(e.params.format);
          by[key] ??= { imp: 0, click: 0 };
          if (e.name === "ad_impression") {
            by[key].imp++;
            if (e.params.ad_source === "adsense") {
              expect(e.params.ad_revenue).toBeGreaterThan(0);
              expect(e.params.currency).toBe("SGD");
              revenue += Number(e.params.ad_revenue);
            } else expect(e.params.ad_revenue).toBeUndefined();
          }
          if (e.name === "ad_click") by[key].click++;
        }
    const ctr = (k: string) => by[k].click / by[k].imp;
    expect(Object.keys(by).sort()).toEqual(["adsense", "google_display", "google_search_text", "meta_feed", "meta_story"]);
    expect(ctr("google_search_text")).toBeGreaterThan(ctr("meta_feed"));
    expect(ctr("meta_feed")).toBeGreaterThan(ctr("google_display"));
    expect(revenue).toBeGreaterThan(0);
  });

  it("drops events older than the 72 h backdating limit", () => {
    const now = Date.parse("2026-11-03T04:00:00Z");
    const old = generateDay("2026-10-30").payloads;
    const kept = clampToMpWindow(old, now);
    for (const p of kept) for (const e of p.events) expect(e.timestamp_micros / 1000).toBeGreaterThan(now - MP_MAX_BACKDATE_MS);
  });

  it("writes GA4 cost-import CSV without term/content columns", () => {
    const csv = costCsv(["2026-11-01", "2026-11-02"]);
    const [header, first] = csv.trim().split("\n");
    expect(header).toBe(COST_COLUMNS.join(","));
    expect(header).not.toMatch(/utm_term|utm_content/);
    expect(first).toMatch(/^google,cpc,search-mrt-times,gads-001,2026-11-01,SGD,\d+,\d+,\d+\.\d{2}$/);
    expect(recentDates(Date.parse("2026-11-03T04:00:00Z"), 2)).toEqual(["2026-11-01", "2026-11-02"]);
  });
});
