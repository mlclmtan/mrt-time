"use client";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Consent } from "@/lib/analytics/consent";
import { vercelFlagsFromEnv, vercelInsights, vercelSafeUrl } from "@/lib/analytics/vercel";

const FLAGS = vercelFlagsFromEnv();

/**
 * Vercel Web Analytics + Speed Insights, mounted only with analytics consent
 * (see `vercelInsights`). `stillAllowed` is checked again on every send, so a
 * consent withdrawal stops collection at once even though the script stays
 * loaded until the next page load.
 */
export function VercelInsights({
  consent,
  internal,
  stillAllowed,
}: {
  consent: Pick<Consent, "analytics">;
  internal: boolean;
  stillAllowed: () => boolean;
}) {
  const on = vercelInsights(consent, FLAGS, internal);
  if (!on.analytics && !on.speedInsights) return null;
  return (
    <>
      {on.analytics && (
        <Analytics debug={false} beforeSend={(e) => (stillAllowed() ? { ...e, url: vercelSafeUrl(e.url) } : null)} />
      )}
      {on.speedInsights && (
        <SpeedInsights debug={false} beforeSend={(e) => (stillAllowed() ? { ...e, url: vercelSafeUrl(e.url) } : null)} />
      )}
    </>
  );
}
