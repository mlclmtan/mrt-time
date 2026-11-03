import { en, zhHant, type DictKey } from "./dict";

export type Locale = "en" | "zh-Hant";
export const LOCALES: Locale[] = ["en", "zh-Hant"];
export const LOCALE_COOKIE = "mrt_lang";
export const LOCALE_HEADER = "x-mrt-locale";
export type { DictKey };

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "zh-Hant";
}

export function translate(locale: Locale, key: DictKey, params?: Record<string, string | number>): string {
  const template = (locale === "zh-Hant" ? zhHant : en)[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (params[name] != null ? String(params[name]) : `{${name}}`));
}

export type T = (key: DictKey, params?: Record<string, string | number>) => string;
export function makeT(locale: Locale): T {
  return (key, params) => translate(locale, key, params);
}

/** "/station/x" → "/zh-Hant/station/x" for Chinese. */
export function localePath(locale: Locale, path: string) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === "en") return clean;
  return clean === "/" ? "/zh-Hant" : `/zh-Hant${clean}`;
}

/** Strip the locale prefix: "/zh-Hant/plan" → { locale: "zh-Hant", path: "/plan" }. */
export function splitLocale(pathname: string): { locale: Locale | null; path: string } {
  const match = /^\/zh-Hant(?=\/|$)(.*)$/i.exec(pathname);
  if (match) return { locale: "zh-Hant", path: match[1] || "/" };
  return { locale: null, path: pathname };
}

export const htmlLang = (locale: Locale) => (locale === "zh-Hant" ? "zh-Hant" : "en-SG");
