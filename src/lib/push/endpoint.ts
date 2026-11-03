import { z } from "zod";

/** Only real browser push services; never arbitrary URLs. */
export function trustedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      [
        "fcm.googleapis.com",
        "push.services.mozilla.com",
        "push.apple.com",
        "notify.windows.com",
      ].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}
const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);
export const subscriptionSchema = z.object({
  endpoint: z.url().max(4096).refine(trustedPushEndpoint),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: base64url
      .max(88)
      .refine((value) => Buffer.from(value, "base64url").length === 65),
    auth: base64url
      .max(24)
      .refine((value) => Buffer.from(value, "base64url").length === 16),
  }),
});
