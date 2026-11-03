"use client";
import { usePathname } from "next/navigation";
import { LOCALE_COOKIE, localePath, splitLocale } from "@/lib/i18n";
import { useI18n } from "./i18n";

export function LanguageSwitch() {
  const { locale, t } = useI18n();
  const pathname = usePathname();
  const next = locale === "en" ? "zh-Hant" : "en";
  const switchTo = () => {
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax`;
    const { path } = splitLocale(pathname);
    window.location.href = localePath(next, path) + window.location.search;
  };
  return (
    <button type="button" onClick={switchTo} aria-label={t("lang.label")} className="rounded-full border border-line px-3 py-1 text-sm">
      {t("lang.switch")}
    </button>
  );
}
