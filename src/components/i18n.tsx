"use client";
import { createContext, useContext, useMemo } from "react";
import { localePath, makeT, type Locale, type T } from "@/lib/i18n";

const I18nContext = createContext<{ locale: Locale; t: T; href: (path: string) => string }>({
  locale: "en",
  t: makeT("en"),
  href: (p) => p,
});

export function I18nProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(locale), href: (path: string) => localePath(locale, path) }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
