"use client";
import { useState } from "react";
import { useAnalytics } from "./analytics-provider";
import { useI18n } from "../i18n";

/** Accept / reject / customise. Nothing third-party loads before a choice. */
export function ConsentBanner() {
  const { consent, setConsent } = useAnalytics();
  const { t } = useI18n();
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);
  if (consent.decided) return null;
  return (
    <div role="dialog" aria-labelledby="consent-title" className="fixed inset-x-0 bottom-0 z-50 p-3 safe-bottom">
      <div className="panel rise mx-auto max-w-xl p-4 shadow-2xl">
        <h2 id="consent-title" className="font-semibold">
          {t("consent.title")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("consent.body")}</p>
        {custom && (
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> {t("consent.analytics")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> {t("consent.marketing")}
            </label>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setConsent({ analytics: true, marketing: true })}>
            {t("consent.accept")}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setConsent({ analytics: false, marketing: false })}>
            {t("consent.reject")}
          </button>
          {custom ? (
            <button type="button" className="btn btn-secondary" onClick={() => setConsent({ analytics, marketing })}>
              {t("consent.save")}
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setCustom(true)}>
              {t("consent.customise")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings toggles for the same choices. */
export function ConsentSettings() {
  const { consent, setConsent } = useAnalytics();
  const { t } = useI18n();
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={consent.analytics} onChange={(e) => setConsent({ analytics: e.target.checked, marketing: consent.marketing })} />{" "}
        {t("consent.analytics")}
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={consent.marketing} onChange={(e) => setConsent({ analytics: consent.analytics, marketing: e.target.checked })} />{" "}
        {t("consent.marketing")}
      </label>
    </div>
  );
}
