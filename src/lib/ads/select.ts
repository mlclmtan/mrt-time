/**
 * House-ad serving, pure and deterministic given `rand`:
 *  1. Eligible campaigns: active, inside start/end, targeting matches the
 *     context (contextual only: station, line, language, time band, device;
 *     an empty list means "any").
 *  2. Pacing: a campaign stops for the day once simulated spend (CPM per
 *     impression / CPC per click) reaches its daily budget.
 *  3. Frequency cap: at most 3 impressions per campaign per session.
 *  4. Campaigns compete on effective CPM (CPC bids × an assumed 1% CTR);
 *     within the campaign, creatives rotate by weight (A/B tests).
 */
import { timeBand } from "../predict/bands";
import type { AdTargeting } from "../db/schema";
import { sgtMidnight } from "../time";
import type { AdFormat, AdPlacement, BidModel } from "./formats";

export const FREQUENCY_CAP = 3;
/** Used only to rank CPC bids against CPM bids. */
export const ASSUMED_CTR = 0.01;

export type ServeCampaign = {
  id: number;
  slug: string;
  status: string;
  startAt: number;
  endAt: number | null;
  dailyBudgetSgd: number;
  bidModel: BidModel;
  bidAmountSgd: number;
  targeting: AdTargeting;
};
export type ServeCreative = { id: number; campaignId: number; format: AdFormat; weight: number; status: string };
export type ServeContext = {
  placement: AdPlacement;
  station?: string | null;
  lines?: string[];
  language: string;
  device: string;
  now: number;
  /** Formats the slot can show (default: all). */
  formats?: AdFormat[];
};
export type Delivery = {
  /** Today's (SGT) non-internal impressions and clicks per campaign. */
  today: Record<number, { impressions: number; clicks: number }>;
  /** This session's impressions per campaign. */
  session: Record<number, number>;
};

export function spendSgd(model: BidModel, bid: number, impressions: number, clicks: number): number {
  return model === "cpm" ? (impressions * bid) / 1000 : clicks * bid;
}

export function effectiveCpm(c: Pick<ServeCampaign, "bidModel" | "bidAmountSgd">): number {
  return c.bidModel === "cpm" ? c.bidAmountSgd : c.bidAmountSgd * ASSUMED_CTR * 1000;
}

const any = (list: string[] | undefined) => !list || list.length === 0;

export function matchesTargeting(t: AdTargeting, ctx: ServeContext): boolean {
  if (!any(t.stations) && !(ctx.station && t.stations!.includes(ctx.station))) return false;
  if (!any(t.lines) && !(ctx.lines ?? []).some((l) => t.lines!.includes(l))) return false;
  if (!any(t.languages) && !t.languages!.includes(ctx.language)) return false;
  if (!any(t.timeBands) && !t.timeBands!.includes(timeBand(ctx.now))) return false;
  if (!any(t.devices) && !t.devices!.includes(ctx.device)) return false;
  return true;
}

export function underBudget(c: ServeCampaign, delivery: Delivery): boolean {
  const d = delivery.today[c.id] ?? { impressions: 0, clicks: 0 };
  return spendSgd(c.bidModel, c.bidAmountSgd, d.impressions, d.clicks) < c.dailyBudgetSgd;
}

export function underFrequencyCap(c: ServeCampaign, delivery: Delivery, cap = FREQUENCY_CAP): boolean {
  return (delivery.session[c.id] ?? 0) < cap;
}

export function isLive(c: ServeCampaign, now: number): boolean {
  return c.status === "active" && c.startAt <= now && (c.endAt == null || now < c.endAt);
}

export function eligibleCampaigns(campaigns: ServeCampaign[], creatives: ServeCreative[], ctx: ServeContext, delivery: Delivery): ServeCampaign[] {
  const formats = ctx.formats;
  return campaigns.filter(
    (c) =>
      isLive(c, ctx.now) &&
      matchesTargeting(c.targeting ?? {}, ctx) &&
      underBudget(c, delivery) &&
      underFrequencyCap(c, delivery) &&
      creatives.some((cr) => cr.campaignId === c.id && cr.status === "active" && cr.weight > 0 && (!formats || formats.includes(cr.format))),
  );
}

export function weightedPick<T>(items: T[], weight: (t: T) => number, rand: () => number): T | null {
  const total = items.reduce((s, i) => s + Math.max(0, weight(i)), 0);
  if (total <= 0) return null;
  let x = rand() * total;
  for (const item of items) if ((x -= Math.max(0, weight(item))) < 0) return item;
  return items[items.length - 1];
}

export function selectCreative(
  campaigns: ServeCampaign[],
  creatives: ServeCreative[],
  ctx: ServeContext,
  delivery: Delivery,
  rand: () => number = Math.random,
): { campaign: ServeCampaign; creative: ServeCreative } | null {
  const eligible = eligibleCampaigns(campaigns, creatives, ctx, delivery);
  const campaign = weightedPick(eligible, effectiveCpm, rand);
  if (!campaign) return null;
  const pool = creatives.filter((cr) => cr.campaignId === campaign.id && cr.status === "active" && (!ctx.formats || ctx.formats.includes(cr.format)));
  const creative = weightedPick(pool, (cr) => cr.weight, rand);
  return creative ? { campaign, creative } : null;
}

/** Start of the SGT day for pacing. */
export const pacingDayStart = (now: number) => sgtMidnight(now);

export type { AdPlacement };
