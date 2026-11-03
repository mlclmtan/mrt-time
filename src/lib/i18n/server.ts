import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, LOCALE_HEADER, makeT, type Locale } from ".";

/** Locale from the /zh-Hant prefix (set by the proxy) or the language cookie. */
export async function getLocale(): Promise<Locale> {
  const fromHeader = (await headers()).get(LOCALE_HEADER);
  if (isLocale(fromHeader)) return fromHeader;
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(fromCookie) ? fromCookie : "en";
}

export async function getT() {
  const locale = await getLocale();
  return { locale, t: makeT(locale) };
}
