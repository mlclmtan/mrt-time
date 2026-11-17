/**
 * Vercel Web Analytics + Speed Insights (Hobby free tier). Both are opt-in
 * per deployment (`NEXT_PUBLIC_VERCEL_ANALYTICS=1`,
 * `NEXT_PUBLIC_VERCEL_SPEED_INSIGHTS=1`, after enabling them in the Vercel
 * dashboard) and, like every other third-party measurement here, load only
 * with analytics consent and never for owner/analyst traffic.
 */
import type { Consent } from "./consent";

export type VercelFlags = { analytics: boolean; speedInsights: boolean };

const on = (value: string | undefined) => value === "1" || value === "true";

/** Flags from env (inlined at build: literal `process.env.NEXT_PUBLIC_*` reads). */
export function vercelFlagsFromEnv(): VercelFlags {
  return {
    analytics: on(process.env.NEXT_PUBLIC_VERCEL_ANALYTICS),
    speedInsights: on(process.env.NEXT_PUBLIC_VERCEL_SPEED_INSIGHTS),
  };
}

/** Which Vercel collectors may run for this consent / user. */
export function vercelInsights(
  consent: Pick<Consent, "analytics">,
  flags: VercelFlags,
  internal: boolean,
): VercelFlags {
  const allowed = consent.analytics && !internal;
  return { analytics: allowed && flags.analytics, speedInsights: allowed && flags.speedInsights };
}

const KEEP_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

/**
 * URL sent to Vercel: origin + path, keeping only UTM parameters (campaign
 * reports) — any other query string or hash can carry PII and is dropped.
 */
export function vercelSafeUrl(url: string): string {
  try {
    const u = new URL(url);
    const kept = new URLSearchParams();
    for (const key of KEEP_PARAMS) {
      const value = u.searchParams.get(key);
      if (value) kept.set(key, value.slice(0, 100));
    }
    const query = kept.toString();
    return `${u.origin}${u.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}
