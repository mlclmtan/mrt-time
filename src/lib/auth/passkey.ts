/** Pure passkey helpers shared by the auth server config and Settings UI. */
import { isNetworkError, OFFLINE_MESSAGE } from "../errors";

/**
 * WebAuthn relying party derived from the canonical app origin. The RP ID must
 * equal (or be a registrable suffix of) the page host, so it comes from
 * BETTER_AUTH_URL rather than whatever host a request happened to use.
 */
export function relyingParty(url: string | undefined) {
  try {
    const parsed = new URL((url || "").trim() || "http://localhost:3000");
    return { rpID: parsed.hostname, origin: parsed.origin };
  } catch {
    return { rpID: "localhost", origin: "http://localhost:3000" };
  }
}

/** A short, human device label from a user agent ("iPhone", "Mac", …). */
export function deviceLabel(userAgent: string, maxTouchPoints = 0): string {
  const ua = userAgent || "";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  // iPadOS asks for desktop sites and reports itself as a Mac with touch.
  if (/Macintosh|Mac OS X/.test(ua)) return maxTouchPoints > 1 ? "iPad" : "Mac";
  if (/Android/.test(ua))
    return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux computer";
  return "This device";
}

/** "iPhone · 13 Oct", made unique against names already on the account. */
export function defaultPasskeyName(
  userAgent: string,
  maxTouchPoints: number,
  now: number,
  existing: (string | null | undefined)[] = [],
): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
  }).format(now);
  const base = `${deviceLabel(userAgent, maxTouchPoints)} · ${date}`;
  const taken = new Set(existing.map((name) => (name || "").trim()));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++)
    if (!taken.has(`${base} (${n})`)) return `${base} (${n})`;
}

export type PasskeyFailure = {
  message: string;
  /** The server wants a recent sign-in before it will register a key. */
  reauth?: boolean;
  /** Not really an error: the user closed the prompt. */
  cancelled?: boolean;
};

type ErrorLike = {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
} | null;

/** Map Better Auth / SimpleWebAuthn / WebAuthn failures to friendly words. */
export function passkeyFailure(error: unknown, online = true): PasskeyFailure {
  const e = (
    error && typeof error === "object" ? error : {}
  ) as NonNullable<ErrorLike>;
  const code = e.code || "";
  const message = e.message || "";
  if (!online || isNetworkError(e)) return { message: OFFLINE_MESSAGE };
  if (
    code === "SESSION_NOT_FRESH" ||
    (e.status === 403 && /fresh/i.test(message))
  )
    return {
      reauth: true,
      message:
        "For safety, adding a key needs a sign-in from the last 24 hours. Confirm it's you, then tap Add again.",
    };
  if (code === "UNAUTHORIZED" || e.status === 401)
    return { message: "Your sign-in has ended. Please sign in again." };
  if (
    code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" ||
    e.name === "InvalidStateError" ||
    /previously registered/i.test(message)
  )
    return {
      message:
        "This device already has a key for MRT Time. It may have synced here from iCloud Keychain or your password manager, so you're all set.",
    };
  if (
    code === "ERROR_CEREMONY_ABORTED" ||
    code === "REGISTRATION_CANCELLED" ||
    code === "AUTH_CANCELLED" ||
    /cancel/i.test(message)
  )
    return {
      cancelled: true,
      message:
        "No worries, the passkey prompt was closed. Tap again whenever you're ready.",
    };
  if (
    code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" ||
    e.name === "NotAllowedError" ||
    /not allowed|timed out|denied/i.test(message)
  )
    return {
      cancelled: true,
      message:
        "The passkey prompt was cancelled or timed out. Tap again and finish with Face ID, Touch ID or your device PIN.",
    };
  if (
    code === "ERROR_INVALID_RP_ID" ||
    code === "ERROR_INVALID_DOMAIN" ||
    e.name === "SecurityError"
  )
    return {
      message:
        "Passkeys only work on MRT Time's main web address. Open the app from mrt.91208274.xyz and try again.",
    };
  if (/not supported/i.test(message) || e.name === "NotSupportedError")
    return {
      message:
        "This browser can't make passkeys. Try Safari or Chrome, or keep using Google sign-in.",
    };
  if (code.startsWith("ERROR_AUTHENTICATOR"))
    return {
      message:
        "This device couldn't create a passkey. Try another device or a security key.",
    };
  if (
    code === "CHALLENGE_NOT_FOUND" ||
    code === "FAILED_TO_VERIFY_REGISTRATION"
  )
    return {
      message:
        "The server couldn't confirm that key (the prompt may have taken a while). Please try once more.",
    };
  return { message: message || "The passkey wasn't added. Please try again." };
}
