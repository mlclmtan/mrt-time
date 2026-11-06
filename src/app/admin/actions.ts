"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/lib/auth/server";
import { dbConfigured, getDb } from "@/lib/db";
import { adCampaign, adCreative, appSetting, campaign, experiment, kol, observation } from "@/lib/db/schema";
import { parseCampaignForm, parseCreativeForm } from "@/lib/ads/admin-input";
import { clearAdCatalog } from "@/lib/server/ads";
import { buildCampaignUrl, utmToken } from "@/lib/analytics/utm";
import { clearWindowsCache } from "@/lib/server/observations";
import { appUrl } from "@/lib/seo";
import { parseWindows } from "@/lib/server/admin";

async function owner() {
  const session = await getSession();
  if (session?.user.role !== "owner" || !dbConfigured()) throw new Error("Not allowed");
  return session.user;
}

export async function moderateReading(formData: FormData) {
  await owner();
  const id = Number(formData.get("id"));
  const status = formData.get("status") === "approved" ? "approved" : "rejected";
  if (!Number.isInteger(id)) return;
  await getDb().update(observation).set({ status, reviewedAt: new Date() }).where(eq(observation.id, id));
  revalidatePath("/admin/submissions");
}

const kolInput = z.object({
  handle: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  displayName: z.string().min(1).max(60),
  platform: z.enum(["instagram", "tiktok", "youtube", "xhs", "threads", "other"]),
  code: z.string().regex(/^[A-Z0-9_-]{2,20}$/),
  landingVariant: z.enum(["default", "planner"]),
  notes: z.string().max(500).optional(),
});

export async function saveKol(formData: FormData) {
  await owner();
  const parsed = kolInput.safeParse({
    handle: String(formData.get("handle") || "").toLowerCase().trim(),
    displayName: String(formData.get("displayName") || "").trim(),
    platform: formData.get("platform"),
    code: String(formData.get("code") || "").toUpperCase().trim(),
    landingVariant: formData.get("landingVariant") || "default",
    notes: String(formData.get("notes") || "") || undefined,
  });
  if (!parsed.success) return;
  await getDb()
    .insert(kol)
    .values(parsed.data)
    .onConflictDoUpdate({ target: kol.handle, set: { ...parsed.data } });
  revalidatePath("/admin/kols");
}

export async function toggleKol(formData: FormData) {
  await owner();
  const id = Number(formData.get("id"));
  await getDb().update(kol).set({ active: formData.get("active") === "1" }).where(eq(kol.id, id));
  revalidatePath("/admin/kols");
}

export async function createCampaign(formData: FormData) {
  await owner();
  const field = (k: string) => String(formData.get(k) || "").trim();
  const source = utmToken(field("source"));
  const medium = utmToken(field("medium"));
  const name = utmToken(field("campaign"));
  if (!source || !medium || !name) return;
  const landingPath = field("landingPath").startsWith("/") ? field("landingPath") : "/";
  const url = buildCampaignUrl({
    baseUrl: appUrl(),
    landingPath,
    source,
    medium,
    campaign: name,
    content: field("content") || undefined,
    term: field("term") || undefined,
    campaignId: field("campaignId") || undefined,
  });
  await getDb()
    .insert(campaign)
    .values({
      name: field("name") || name,
      source,
      medium,
      campaign: name,
      content: utmToken(field("content")) ?? null,
      term: utmToken(field("term")) ?? null,
      campaignId: utmToken(field("campaignId")) ?? null,
      landingPath,
      url,
    });
  revalidatePath("/admin/campaigns");
}

export async function saveExperiment(formData: FormData) {
  await owner();
  const key = utmToken(String(formData.get("key") || ""));
  const name = String(formData.get("name") || "").slice(0, 80);
  const variants = String(formData.get("variants") || "")
    .split(",")
    .map((p) => p.trim().split(":"))
    .map(([k, w]) => ({ key: utmToken(k) ?? "", weight: Math.max(0, Number(w) || 0) }))
    .filter((v) => v.key);
  if (!key || variants.length < 2) return;
  const active = formData.get("active") === "on";
  await getDb()
    .insert(experiment)
    .values({ key, name: name || key, variants, active })
    .onConflictDoUpdate({ target: experiment.key, set: { name: name || key, variants, active } });
  revalidatePath("/admin/experiments");
}

export async function saveUnstableWindows(formData: FormData) {
  await owner();
  const windows = parseWindows(String(formData.get("windows") || ""));
  await getDb()
    .insert(appSetting)
    .values({ key: "unstable_windows", value: windows })
    .onConflictDoUpdate({ target: appSetting.key, set: { value: windows, updatedAt: new Date() } });
  clearWindowsCache();
  revalidatePath("/admin/settings");
}

export async function saveAdCampaign(formData: FormData) {
  await owner();
  const parsed = parseCampaignForm(formData);
  if (!parsed) return;
  const db = getDb();
  if (parsed.id) await db.update(adCampaign).set({ ...parsed.values, updatedAt: new Date() }).where(eq(adCampaign.id, parsed.id));
  else await db.insert(adCampaign).values(parsed.values).onConflictDoNothing();
  clearAdCatalog();
  revalidatePath("/admin/ads");
}

export async function saveAdCreative(formData: FormData) {
  await owner();
  const parsed = parseCreativeForm(formData);
  if (!parsed) return;
  const db = getDb();
  if (parsed.id) await db.update(adCreative).set({ ...parsed.values, updatedAt: new Date() }).where(eq(adCreative.id, parsed.id));
  else await db.insert(adCreative).values(parsed.values);
  clearAdCatalog();
  revalidatePath("/admin/ads");
}
