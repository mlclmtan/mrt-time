/** Voice of customer: feedback, NPS and newsletter (stored in Neon only). */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { feedback, newsletter, npsResponse } from "../db/schema";
import { FEEDBACK_CATEGORIES } from "../analytics/events";

export const feedbackInput = z.strictObject({
  rating: z.number().int().min(1).max(5),
  category: z.enum(FEEDBACK_CATEGORIES),
  text: z.string().trim().max(2000).optional(),
  route: z.string().max(200).optional(),
  language: z.enum(["en", "zh-Hant"]).optional(),
  deviceId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/).nullish(),
});
export const npsInput = z.strictObject({
  score: z.number().int().min(0).max(10),
  comment: z.string().trim().max(1000).optional(),
  deviceId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/).nullish(),
});
export const newsletterInput = z.strictObject({
  email: z.email().max(200),
  consent: z.literal(true),
  language: z.enum(["en", "zh-Hant"]).optional(),
  source: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
});

export async function saveFeedback(input: z.infer<typeof feedbackInput>, userType: string) {
  await getDb().insert(feedback).values({
    rating: input.rating,
    category: input.category,
    text: input.text || null,
    route: input.route?.split("?")[0] ?? null,
    language: input.language ?? null,
    deviceId: input.deviceId ?? null,
    userType,
  });
}

export async function saveNps(input: z.infer<typeof npsInput>) {
  await getDb().insert(npsResponse).values({ score: input.score, comment: input.comment || null, deviceId: input.deviceId ?? null });
}

export function resendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.NEWSLETTER_FROM?.trim() && process.env.APP_URL?.trim());
}

/**
 * Store the email with its consent timestamp. With RESEND_API_KEY set,
 * send a double opt-in link; without it, just store (confirmed later).
 */
export async function subscribe(input: z.infer<typeof newsletterInput>, fetchImpl: typeof fetch = fetch) {
  const email = input.email.trim().toLowerCase();
  const doubleOptIn = resendConfigured();
  const token = doubleOptIn ? randomBytes(24).toString("base64url") : null;
  await getDb()
    .insert(newsletter)
    .values({ email, consentAt: new Date(), confirmToken: token, language: input.language ?? null, source: input.source ?? null })
    .onConflictDoUpdate({ target: newsletter.email, set: { consentAt: new Date(), unsubscribedAt: null, confirmToken: token } });
  if (doubleOptIn && token) {
    const link = new URL(`/api/newsletter/confirm?token=${token}`, process.env.APP_URL).toString();
    await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.NEWSLETTER_FROM,
        to: [email],
        subject: input.language === "zh-Hant" ? "請確認訂閱 MRT Time" : "Confirm your MRT Time subscription",
        html: `<p>${input.language === "zh-Hant" ? "請點擊以下連結確認訂閱：" : "Tap to confirm your subscription:"}</p><p><a href="${link}">${link}</a></p>`,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }
  return { doubleOptIn };
}

export async function confirmSubscription(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const rows = await getDb()
    .update(newsletter)
    .set({ confirmedAt: new Date(), confirmToken: null })
    .where(eq(newsletter.confirmToken, token))
    .returning({ id: newsletter.id });
  return rows.length > 0;
}
