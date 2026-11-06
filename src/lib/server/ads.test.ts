/**
 * House ads end to end on real Postgres (PGlite) with the generated
 * migrations: idempotent seed, serving with pacing/caps, event logging,
 * and the admin report (spend, CTR, viewable %, post-click conversions).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDb } from "@/test/pglite";
import { adCampaign, adCreative, eventLog } from "../db/schema";
import { sgtInstant } from "../time";
import { seedAds, HOUSE_CAMPAIGNS } from "../../../scripts/seed-ads";
import { adReport, clearAdCatalog, clickDestination, logAdEvent, serveAd } from "./ads";
import { rowsOf } from "../db";

type Db = Awaited<ReturnType<typeof testDb>>["db"];
let db: Db;
const exec = () => db as never;
const NOW = sgtInstant("2026-11-03", "13:00");
const range = { from: new Date(sgtInstant("2026-11-03", "00:00")), to: new Date(sgtInstant("2026-11-04", "00:00")) };

beforeAll(async () => {
  db = (await testDb()).db;
});

describe("house ads on Postgres", () => {
  it("seeds three self-promotional campaigns idempotently", async () => {
    const first = await seedAds(db as never);
    const again = await seedAds(db as never);
    expect(first).toEqual({ campaigns: 3, creatives: 4 });
    expect(again).toEqual(first);
    const campaigns = await db.select().from(adCampaign);
    const creatives = await db.select().from(adCreative);
    expect(campaigns.map((c) => c.slug).sort()).toEqual(["accuracy-report", "install-mrt-time", "join-newsletter"]);
    expect(campaigns.every((c) => c.advertiser === "MRT Time")).toBe(true);
    expect(creatives.map((c) => c.format).sort()).toEqual(["google_display", "google_search_text", "meta_feed", "meta_story"]);
    expect(HOUSE_CAMPAIGNS.flatMap((c) => c.creatives.map((cr) => cr.destinationUrl)).every((u) => u.startsWith("/"))).toBe(true);
  });

  it("serves a targeted creative, logs events and stops at the session cap", async () => {
    clearAdCatalog();
    // Push the start back so seeded campaigns are live at NOW.
    await db.execute(sql`update ad_campaign set start_at = '2026-11-01T00:00:00Z'`);
    const ctx = { placement: "station" as const, station: "tiong-bahru", lines: ["EWL"], language: "en", device: "desktop", now: NOW };
    // Desktop: the install campaign targets mobile/tablet only.
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const ad = await serveAd(ctx, "sess-desktop-1", "https://mrt.example", exec());
      seen.add(ad!.campaign);
    }
    expect([...seen].sort()).toEqual(["accuracy-report", "join-newsletter"]);

    const session = "sess-cap-0001";
    for (let i = 0; i < 6; i++) {
      const ad = await serveAd(ctx, session, "https://mrt.example", exec());
      if (!ad) break;
      expect(ad.clickUrl).toBe(`/api/ads/click?c=${ad.id}&p=station&s=${session}`);
      await logAdEvent({ type: "impression", creativeId: ad.id, placement: "station", sessionId: session, deviceId: null, internal: false, now: NOW }, exec());
    }
    // 2 eligible campaigns × cap 3 = 6 impressions, then nothing.
    expect(await serveAd(ctx, session, "https://mrt.example", exec())).toBeNull();
    expect(await logAdEvent({ type: "impression", creativeId: 9999, placement: "station", sessionId: session, deviceId: null, internal: false }, exec())).toBeNull();
  });

  it("reports impressions, viewable %, CTR, simulated spend and post-click conversions", async () => {
    await db.execute(sql`delete from ad_event`);
    const [search] = await db.select().from(adCreative).where(sql`format = 'google_search_text'`);
    const log = (type: "impression" | "viewable" | "click", sessionId: string, internal = false) =>
      logAdEvent({ type, creativeId: search.id, placement: "station_sponsored", sessionId, deviceId: null, internal, now: NOW }, exec());
    for (let i = 0; i < 10; i++) await log("impression", `s-${i}`);
    for (let i = 0; i < 6; i++) await log("viewable", `s-${i}`);
    await log("click", "s-1");
    await log("click", "s-2");
    await log("impression", "owner-1", true); // internal: excluded
    await log("click", "owner-1", true);
    // s-1 plans a trip after the click; s-2's planner use was before it.
    await db.insert(eventLog).values([
      { ts: new Date(NOW + 60_000), name: "planner_query", sessionId: "s-1", deviceId: "d-1", props: {} },
      { ts: new Date(NOW + 120_000), name: "newsletter_signup", sessionId: "s-1", deviceId: "d-1", props: {} },
      { ts: new Date(NOW - 60_000), name: "planner_query", sessionId: "s-2", deviceId: "d-2", props: {} },
    ]);
    const [row] = await adReport(db as never, range, "campaign");
    expect(row).toMatchObject({
      campaign: "Read the accuracy report",
      impressions: 10,
      viewable: 6,
      viewable_pct: 60,
      clicks: 2,
      ctr_pct: 20,
      spend_sgd: 0.4, // CPC S$0.20 × 2
      ecpm_sgd: 40,
      ecpc_sgd: 0.2,
      conversions: 2,
    });
    for (const by of ["creative", "format", "placement"] as const) {
      const rows = await adReport(db as never, range, by);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ impressions: 10, clicks: 2, conversions: 2 });
    }
    expect((await adReport(db as never, range, "format"))[0].format).toBe("google_search_text");
    expect(rowsOf<{ n: number }>(await db.execute(sql`select count(*)::int as n from ad_event where internal`))[0].n).toBe(2);
  });

  it("click destinations carry UTM and stay on the creative's URL", () => {
    const to = clickDestination({ id: 4, format: "google_search_text", destinationUrl: "/accuracy", slug: "accuracy-report" }, "https://mrt.example");
    expect(to).toBe("https://mrt.example/accuracy?utm_source=mrt_house&utm_medium=google_search_text&utm_campaign=accuracy-report&utm_content=4");
  });
});
