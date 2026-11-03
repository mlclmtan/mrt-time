import { cookies } from "next/headers";
import { getSession } from "../auth/server";
import type { UserType } from "../analytics/mapping";
import { parseConsent, CONSENT_COOKIE, type Consent } from "../analytics/consent";

const SESSION_COOKIE = /(^|;\s*)(__Secure-)?better-auth\.session_token=/;

/** owner / analyst / visitor — only looks up a session when a session cookie exists. */
export async function userTypeFor(request: Request): Promise<UserType> {
  if (!SESSION_COOKIE.test(request.headers.get("cookie") || "")) return "visitor";
  const session = await getSession();
  return session?.user.role ?? "visitor";
}

export async function consentFromCookies(): Promise<Consent> {
  return parseConsent((await cookies()).get(CONSENT_COOKIE)?.value);
}
