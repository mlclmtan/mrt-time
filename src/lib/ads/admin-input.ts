/** Admin form → validated ad campaign / creative values (pure, tested). */
import { z } from "zod";
import { LINE_CODE_LIST, STATIONS } from "../network/data";
import { sgtInstant } from "../time";
import type { AdTargeting } from "../db/schema";
import { AD_BID_MODELS, AD_DEVICES, AD_FORMATS, AD_OBJECTIVES, AD_TIME_BANDS, validImageData } from "./formats";

type Form = { get(name: string): FormDataEntryValue | null; getAll(name: string): FormDataEntryValue[] };

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const num = (min: number, max: number) => z.coerce.number().finite().min(min).max(max);
const optionalId = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().positive().optional());

export const campaignInput = z.object({
  id: optionalId,
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,47}$/),
  name: z.string().trim().min(1).max(80),
  advertiser: z.string().trim().min(1).max(60),
  objective: z.enum(AD_OBJECTIVES),
  status: z.enum(["active", "paused", "ended"]),
  start: date,
  end: z.union([date, z.literal("")]),
  dailyBudgetSgd: num(0, 10_000),
  bidModel: z.enum(AD_BID_MODELS),
  bidAmountSgd: num(0, 1_000),
});

const pick = (form: Form, name: string, allowed: readonly string[]) =>
  form
    .getAll(name)
    .map(String)
    .filter((v) => allowed.includes(v));

export function targetingFrom(form: Form): AdTargeting {
  const t: AdTargeting = {
    stations: pick(form, "stations", STATIONS.map((s) => s.slug)),
    lines: pick(form, "lines", [...LINE_CODE_LIST]),
    languages: pick(form, "languages", ["en", "zh-Hant"]),
    timeBands: pick(form, "timeBands", AD_TIME_BANDS),
    devices: pick(form, "devices", AD_DEVICES),
  };
  return Object.fromEntries(Object.entries(t).filter(([, v]) => v.length)) as AdTargeting;
}

export function parseCampaignForm(form: Form) {
  const raw = Object.fromEntries(["id", "slug", "name", "advertiser", "objective", "status", "start", "end", "dailyBudgetSgd", "bidModel", "bidAmountSgd"].map((k) => [k, String(form.get(k) ?? "").trim()]));
  const parsed = campaignInput.safeParse({ ...raw, slug: raw.slug.toLowerCase() });
  if (!parsed.success) return null;
  const { id, start, end, ...rest } = parsed.data;
  const startAt = new Date(sgtInstant(start, "00:00"));
  const endAt = end ? new Date(sgtInstant(end, "00:00") + 24 * 3_600_000) : null; // inclusive end date
  if (endAt && endAt <= startAt) return null;
  return { id, values: { ...rest, startAt, endAt, targeting: targetingFrom(form) } };
}

/** https URLs, or app paths like "/accuracy". */
const urlOrPath = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/(?!\/)/.test(v) || /^https?:\/\/[^\s]+$/.test(v), "Use https://… or a path starting with /");

export const creativeInput = z.object({
  id: optionalId,
  campaignId: z.coerce.number().int().positive(),
  format: z.enum(AD_FORMATS),
  headline: z.string().trim().min(1).max(90),
  primaryText: z.string().trim().max(300),
  description: z.string().trim().max(200),
  imageUrl: z.union([z.literal(""), urlOrPath]),
  imageData: z.string().refine((v) => v === "" || validImageData(v), "Image must be PNG/JPEG/WebP/GIF ≤ 200 KB"),
  ctaLabel: z.string().trim().min(1).max(24),
  destinationUrl: urlOrPath,
  weight: z.coerce.number().int().min(0).max(100),
  status: z.enum(["active", "paused"]),
});

export function parseCreativeForm(form: Form) {
  const raw = Object.fromEntries(
    ["id", "campaignId", "format", "headline", "primaryText", "description", "imageUrl", "imageData", "ctaLabel", "destinationUrl", "weight", "status"].map((k) => [k, String(form.get(k) ?? "")]),
  );
  const parsed = creativeInput.safeParse({ ...raw, weight: raw.weight || "1", status: raw.status || "active" });
  if (!parsed.success) return null;
  const { id, primaryText, description, imageUrl, imageData, ...rest } = parsed.data;
  return {
    id,
    values: { ...rest, primaryText: primaryText || null, description: description || null, imageUrl: imageUrl || null, imageData: imageUrl ? null : imageData || null },
  };
}
