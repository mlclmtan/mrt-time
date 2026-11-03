"use client";
import { useCallback, useState } from "react";
import { useAnalytics } from "./analytics-provider";
import { useI18n } from "../i18n";

/** CSS variable the page uses to pad its bottom while the sheet is shown. */
const SHEET_VAR = "--consent-h";

/**
 * Accept / reject / customise as a compact bottom sheet. Nothing
 * third-party loads before a choice. While shown, the sheet publishes its
 * height (incl. the safe-area inset) as --consent-h so the page can pad
 * its bottom and nothing ends up hidden underneath.
 */
export function ConsentBanner() {
  const { consent, setConsent } = useAnalytics();
  const { t } = useI18n();
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const sheet = useCallback((node: HTMLDivElement | null) => {
    const root = document.documentElement;
    if (!node) {
      root.style.removeProperty(SHEET_VAR);
      return;
    }
    const publish = () => root.style.setProperty(SHEET_VAR, `${Math.ceil(node.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(SHEET_VAR);
    };
  }, []);
  if (consent.decided) return null;
  const small = "btn px-3 py-1.5 text-sm";
  return (
    <div
      ref={sheet}
      role="dialog"
      aria-labelledby="consent-title"
      className="rise fixed inset-x-0 bottom-0 z-50 border-t border-line bg-panel/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-2xl backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-[1_1_16rem] text-xs leading-snug text-muted">
          <strong id="consent-title" className="mr-1 text-ink">
            {t("consent.title")}
          </strong>
          {t("consent.body")}
        </p>
        {custom && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> {t("consent.analytics")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /> {t("consent.marketing")}
            </label>
          </div>
        )}
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" className={`${small} btn-primary`} onClick={() => setConsent({ analytics: true, marketing: true })}>
            {t("consent.accept")}
          </button>
          <button type="button" className={`${small} btn-secondary`} onClick={() => setConsent({ analytics: false, marketing: false })}>
            {t("consent.reject")}
          </button>
          {custom ? (
            <button type="button" className={`${small} btn-secondary`} onClick={() => setConsent({ analytics, marketing })}>
              {t("consent.save")}
            </button>
          ) : (
            <button type="button" className={`${small} btn-secondary`} onClick={() => setCustom(true)}>
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
