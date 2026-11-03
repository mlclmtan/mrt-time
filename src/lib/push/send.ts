import webPush from "web-push";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { pushSubscription } from "../db/schema";
import { pushAvailable } from "./config";
import { trustedPushEndpoint } from "./endpoint";

/** What the service worker shows. */
export type PushMessage = {
  title: string;
  body: string;
  /** Same tag replaces an older notification on the device. */
  tag: string;
  url: string;
};

export function vapidDetails() {
  return {
    subject: process.env.VAPID_SUBJECT!,
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    privateKey: process.env.VAPID_PRIVATE_KEY!,
  };
}
const expired = (error: unknown) => {
  const status = (error as { statusCode?: number }).statusCode;
  return status === 404 || status === 410;
};

/**
 * Send to every device of a user (best effort). Expired subscriptions are
 * removed. Train alerts are time-critical: short TTL, high urgency.
 */
export async function sendToUser(
  userId: string,
  message: PushMessage,
  { ttl = 120 }: { ttl?: number } = {},
) {
  if (!pushAvailable()) return { sent: 0, removed: 0, failed: 0 };
  const db = getDb();
  const devices = await db
    .select()
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, userId));
  let sent = 0,
    removed = 0,
    failed = 0;
  await Promise.all(
    devices.map(async (device) => {
      if (!trustedPushEndpoint(device.endpoint)) return;
      try {
        await webPush.sendNotification(
          {
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth },
          },
          JSON.stringify(message),
          {
            vapidDetails: vapidDetails(),
            TTL: ttl,
            timeout: 10_000,
            urgency: "high",
          },
        );
        sent++;
      } catch (error) {
        if (!expired(error)) {
          failed++;
          return;
        }
        await db
          .delete(pushSubscription)
          .where(
            and(
              eq(pushSubscription.id, device.id),
              eq(pushSubscription.userId, userId),
            ),
          );
        removed++;
      }
    }),
  );
  console.info("[push] sent", { tag: message.tag.split(":")[0], sent, removed, failed });
  return { sent, removed, failed };
}

/** Settings → "Send test notification" for this one device. */
export async function sendTestPush(userId: string, endpoint: string) {
  if (!pushAvailable()) return { status: "unconfigured" as const };
  const db = getDb();
  const device = await db.query.pushSubscription.findFirst({
    where: and(
      eq(pushSubscription.userId, userId),
      eq(pushSubscription.endpoint, endpoint),
    ),
  });
  if (!device || !trustedPushEndpoint(device.endpoint))
    return { status: "missing" as const };
  try {
    await webPush.sendNotification(
      {
        endpoint: device.endpoint,
        keys: { p256dh: device.p256dh, auth: device.auth },
      },
      JSON.stringify({
        title: "Test from MRT Time",
        body: "Notifications work on this device.",
        tag: "mrt:test",
        url: "/settings",
      } satisfies PushMessage),
      { vapidDetails: vapidDetails(), TTL: 60, timeout: 10_000, urgency: "high" },
    );
    return { status: "sent" as const };
  } catch (error) {
    if (expired(error)) {
      await db
        .delete(pushSubscription)
        .where(eq(pushSubscription.id, device.id));
      return { status: "expired" as const };
    }
    throw error;
  }
}
