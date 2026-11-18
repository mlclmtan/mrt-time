import { localePath, type Locale } from "@/lib/i18n";
import type { Role } from "@/lib/auth/access";

/**
 * Returns the destination URL for the /app route:
 * - owner -> /trip (or /zh-Hant/trip)
 * - everyone else -> /stations (or /zh-Hant/stations)
 */
export function getAppRedirectTarget(
  role: Role | string | null | undefined,
  locale: Locale,
): string {
  const target = role === "owner" ? "/trip" : "/stations";
  return localePath(locale, target);
}
