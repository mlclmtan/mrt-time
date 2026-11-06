/** House ads: serving with pacing/frequency caps, event logging and reports. */
import { and, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, rowsOf, type Db } from "../db";
import { adCampaign, adCreative, adEvent, type AdTargeting } from "../db/schema";
import { AD_FORMATS, displayHost, isAdFormat, withAdUtm, type AdEventType, type AdFormat, type AdPlacement, type BidModel } from "../ads/formats";
import { pacingDayStart, selectCreative, type Delivery, type ServeCampaign, type ServeContext, type ServeCreative } from "../ads/select";
import type { Range } from "../analytics/aggregates";
import { DAY } from "../time";

type Exec = Pick<Db, "select" | "insert" | "execute">;

export type AdView = {
  id: number;
  campaignId: number;
  campaign: string; // slug
  advertiser: string;
  format: AdFormat;
  headline: string;
  primaryText: string | null;
  description: string | null;
  image: string | null;
  ctaLabel: string;
  displayHost: string;
  clickUrl: string;
};

type Catalog = { campaigns: (ServeCampaign & { name: string; advertiser: string })[]; creatives: (ServeCreative & typeof adCreative.$inferSelect)[]; at: number };
let catalog: Catalog | null = null;
const CATALOG_TTL_MS = 60_000;
export function clearAdCatalog() {
  catalog = null;
}

/** Live campaigns and their active creatives (cached for a minute). */
export async function loadCatalog(db: Exec = getDb(), now = Date.now()): Promise<Catalog> {
  if (catalog && now - catalog.at < CATALOG_TTL_MS) return catalog;
  const campaigns = await db.select().from(adCampaign).where(eq(adCampaign.status, "active")).limit(200);
  const ids = campaigns.map((c) => c.id);
  const creatives = ids.length
    ? await db.select().from(adCreative).where(and(inArray(adCreative.campaignId, ids), eq(adCreative.status, "active"))).limit(1000)
    : [];
  catalog = {
    at: now,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      advertiser: c.advertiser,
      status: c.status,
      startAt: new Date(c.startAt).getTime(),
      endAt: c.endAt ? new Date(c.endAt).getTime() : null,
      dailyBudgetSgd: c.dailyBudgetSgd,
      bidModel: (c.bidModel === "cpc" ? "cpc" : "cpm") as BidModel,
      bidAmountSgd: c.bidAmountSgd,
      targeting: (c.targeting ?? {}) as AdTargeting,
    })),
    creatives: creatives.filter((cr) => isAdFormat(cr.format)).map((cr) => ({ ...cr, format: cr.format as AdFormat })),
  };
  return catalog;
}

/** Today's spend inputs per campaign and this session's impressions (non-internal only). */
export async function deliveryFor(db: Exec, campaignIds: number[], sessionId: string | null, now: number): Promise<Delivery> {
  const delivery: Delivery = { today: {}, session: {} };
  if (!campaignIds.length) return delivery;
  const dayStart = new Date(pacingDayStart(now));
  const today = await db
    .select({
      campaignId: adEvent.campaignId,
      impressions: sql<number>`count(*) filter (where ${adEvent.type} = 'impression')::int`,
      clicks: sql<number>`count(*) filter (where ${adEvent.type} = 'click')::int`,
    })
    .from(adEvent)
    .where(and(inArray(adEvent.campaignId, campaignIds), gte(adEvent.ts, dayStart), eq(adEvent.internal, false)))
    .groupBy(adEvent.campaignId);
  for (const r of today) delivery.today[r.campaignId] = { impressions: Number(r.impressions), clicks: Number(r.clicks) };
  if (sessionId) {
    const seen = await db
      .select({ campaignId: adEvent.campaignId, n: sql<number>`count(*)::int` })
      .from(adEvent)
      .where(and(eq(adEvent.sessionId, sessionId), eq(adEvent.type, "impression"), gte(adEvent.ts, new Date(now - DAY))))
      .groupBy(adEvent.campaignId);
    for (const r of seen) delivery.session[r.campaignId] = Number(r.n);
  }
  return delivery;
}

export function clickUrl(creativeId: number, placement: AdPlacement, sessionId: string | null) {
  const q = new URLSearchParams({ c: String(creativeId), p: placement });
  if (sessionId) q.set("s", sessionId);
  return `/api/ads/click?${q}`;
}

export async function serveAd(ctx: ServeContext, sessionId: string | null, origin: string, db: Exec = getDb(), rand = Math.random): Promise<AdView | null> {
  const cat = await loadCatalog(db, ctx.now);
  if (!cat.campaigns.length) return null;
  const delivery = await deliveryFor(db, cat.campaigns.map((c) => c.id), sessionId, ctx.now);
  const pick = selectCreative(cat.campaigns, cat.creatives, ctx, delivery, rand);
  if (!pick) return null;
  const cr = cat.creatives.find((c) => c.id === pick.creative.id)!;
  const camp = cat.campaigns.find((c) => c.id === pick.campaign.id)!;
  return {
    id: cr.id,
    campaignId: camp.id,
    campaign: camp.slug,
    advertiser: camp.advertiser,
    format: cr.format,
    headline: cr.headline,
    primaryText: cr.primaryText,
    description: cr.description,
    image: cr.imageUrl || cr.imageData || null,
    ctaLabel: cr.ctaLabel,
    displayHost: displayHost(cr.destinationUrl, origin),
    clickUrl: clickUrl(cr.id, ctx.placement, sessionId),
  };
}

/** Logs one event; returns the creative's campaign/format, or null for unknown creatives. */
export async function logAdEvent(
  input: { type: AdEventType; creativeId: number; placement: AdPlacement; sessionId: string | null; deviceId: string | null; internal: boolean; now?: number },
  db: Exec = getDb(),
) {
  const [cr] = await db
    .select({ id: adCreative.id, campaignId: adCreative.campaignId, format: adCreative.format, destinationUrl: adCreative.destinationUrl, slug: adCampaign.slug })
    .from(adCreative)
    .innerJoin(adCampaign, eq(adCampaign.id, adCreative.campaignId))
    .where(eq(adCreative.id, input.creativeId))
    .limit(1);
  if (!cr) return null;
  await db.insert(adEvent).values({
    ...(input.now ? { ts: new Date(input.now) } : {}),
    type: input.type,
    creativeId: cr.id,
    campaignId: cr.campaignId,
    format: cr.format,
    placement: input.placement,
    sessionId: input.sessionId,
    deviceId: input.deviceId,
    internal: input.internal,
  });
  return cr;
}

/** Destination (with UTM) for a click. */
export function clickDestination(cr: { id: number; format: string; destinationUrl: string; slug: string }, origin: string) {
  return withAdUtm(cr.destinationUrl, { format: cr.format, campaignSlug: cr.slug, creativeId: cr.id }, origin);
}

/* ---------------- Reports ---------------- */

export const AD_REPORT_DIMENSIONS = ["campaign", "creative", "format", "placement"] as const;
export type AdReportDimension = (typeof AD_REPORT_DIMENSIONS)[number];
const KEY: Record<AdReportDimension, SQL> = {
  campaign: sql.raw(`c.name`),
  creative: sql.raw(`concat('#', cr.id, ' ', cr.headline)`),
  format: sql.raw(`e.format`),
  placement: sql.raw(`e.placement`),
};

/** Conversions that count after a click in the same analytics session. */
export const AD_CONVERSIONS = ["planner_query", "app_installed", "newsletter_signup"] as const;

/**
 * Impressions, viewable %, clicks, CTR, simulated spend (CPM per impression,
 * CPC per click at the campaign's bid), effective CPM/CPC and post-click
 * conversions (same session id, after the click, within a day).
 */
export function adReportQuery(r: Range, by: AdReportDimension) {
  const key = KEY[by];
  const from = r.from.toISOString();
  const to = r.to.toISOString();
  return sql`
    with ev as (
      select e.*, ${key} as key, c.bid_model, c.bid_amount_sgd
      from ad_event e
      join ad_campaign c on c.id = e.campaign_id
      join ad_creative cr on cr.id = e.creative_id
      where e.ts >= ${from}::timestamptz and e.ts < ${to}::timestamptz and not e.internal),
    agg as (
      select key,
        count(*) filter (where type = 'impression')::int as impressions,
        count(*) filter (where type = 'viewable')::int as viewable,
        count(*) filter (where type = 'click')::int as clicks,
        coalesce(sum(case when type = 'impression' and bid_model = 'cpm' then bid_amount_sgd / 1000.0
                          when type = 'click' and bid_model = 'cpc' then bid_amount_sgd else 0 end), 0)::float as spend
      from ev group by key),
    conv as (
      select k.key, count(distinct (k.session_id, l.name))::int as conversions
      from ev k
      join event_log l on l.session_id = k.session_id and l.ts >= k.ts and l.ts < k.ts + interval '1 day'
      where k.type = 'click' and k.session_id is not null and l.name in ('planner_query', 'app_installed', 'newsletter_signup')
      group by k.key)
    select agg.key as ${sql.raw(`"${by}"`)},
      impressions, viewable,
      round((100.0 * viewable / nullif(impressions, 0))::numeric, 1)::float as viewable_pct,
      clicks,
      round((100.0 * clicks / nullif(impressions, 0))::numeric, 2)::float as ctr_pct,
      round(spend::numeric, 2)::float as spend_sgd,
      round((1000.0 * spend / nullif(impressions, 0))::numeric, 2)::float as ecpm_sgd,
      round((spend / nullif(clicks, 0))::numeric, 2)::float as ecpc_sgd,
      coalesce(conv.conversions, 0)::int as conversions
    from agg left join conv on conv.key = agg.key
    order by impressions desc, 1`;
}

export async function adReport(db: Pick<Db, "execute">, r: Range, by: AdReportDimension) {
  return rowsOf<Record<string, unknown>>(await db.execute(adReportQuery(r, by)));
}

export const FORMAT_LIST = AD_FORMATS;
