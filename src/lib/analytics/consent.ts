/** Consent state: cookie `mrt_consent` = "v1.a<0|1>.m<0|1>.<unix-seconds>". */
export type Consent = { analytics: boolean; marketing: boolean; decided: boolean; at?: number };

export const CONSENT_COOKIE = "mrt_consent";
export const DENIED: Consent = { analytics: false, marketing: false, decided: false };

export function parseConsent(value: string | null | undefined): Consent {
  const match = /^v1\.a([01])\.m([01])\.(\d{1,12})$/.exec(value ?? "");
  if (!match) return DENIED;
  return { analytics: match[1] === "1", marketing: match[2] === "1", decided: true, at: Number(match[3]) };
}

export function serializeConsent(c: { analytics: boolean; marketing: boolean }, nowMs: number) {
  return `v1.a${c.analytics ? 1 : 0}.m${c.marketing ? 1 : 0}.${Math.floor(nowMs / 1000)}`;
}

/** Google Consent Mode v2 signals for a consent state. */
export function consentModeSignals(c: Pick<Consent, "analytics" | "marketing">) {
  const g = (on: boolean) => (on ? "granted" : "denied");
  return {
    analytics_storage: g(c.analytics),
    ad_storage: g(c.marketing),
    ad_user_data: g(c.marketing),
    ad_personalization: g(c.marketing),
  };
}
