/** SEO helpers: base URL, per-page metadata with hreflang, JSON-LD. */
import type { Metadata } from "next";
import { localePath, makeT, type Locale } from "./i18n";
import { LINES, STATIONS, getPlatform, type Station } from "./network";

export const DEFAULT_APP_URL = "https://mrt.91208274.xyz";
export function appUrl() {
  const raw = process.env.APP_URL?.trim();
  try {
    return raw ? new URL(raw).origin : DEFAULT_APP_URL;
  } catch {
    return DEFAULT_APP_URL;
  }
}

export function pageMetadata(opts: { locale: Locale; path: string; title: string; description: string; image?: string; noindex?: boolean }): Metadata {
  const url = localePath(opts.locale, opts.path);
  return {
    title: opts.title,
    description: opts.description,
    alternates: {
      canonical: url,
      languages: { "en-SG": localePath("en", opts.path), "zh-Hant": localePath("zh-Hant", opts.path), "x-default": localePath("en", opts.path) },
    },
    openGraph: {
      type: "website",
      siteName: "MRT Time",
      title: opts.title,
      description: opts.description,
      url,
      locale: opts.locale === "zh-Hant" ? "zh_TW" : "en_SG",
      ...(opts.image ? { images: [{ url: opts.image, width: 1200, height: 630 }] } : {}),
    },
    twitter: { card: "summary_large_image", title: opts.title, description: opts.description },
    ...(opts.noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export function websiteJsonLd(locale: Locale) {
  const base = appUrl();
  const t = makeT(locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        name: "MRT Time",
        url: `${base}${localePath(locale, "/")}`,
        inLanguage: locale === "zh-Hant" ? "zh-Hant" : "en-SG",
        description: t("app.tagline"),
      },
      {
        "@type": "WebApplication",
        name: "MRT Time",
        url: base,
        applicationCategory: "TravelApplication",
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: "0", priceCurrency: "SGD" },
      },
    ],
  };
}

export function stationJsonLd(station: Station, locale: Locale) {
  const base = appUrl();
  const t = makeT(locale);
  const name = station.name[locale];
  const lines = [...new Set(station.codes.map((c) => LINES[getPlatform(c)!.line].name[locale]))];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TrainStation",
        name: `${name} MRT (${station.codes.join(" / ")})`,
        url: `${base}${localePath(locale, `/station/${station.slug}`)}`,
        geo: { "@type": "GeoCoordinates", latitude: station.lat, longitude: station.lng },
        address: { "@type": "PostalAddress", addressCountry: "SG", addressLocality: "Singapore" },
        description: lines.join(", "),
      },
      {
        "@type": "FAQPage",
        mainEntity: (["1", "2", "3"] as const).map((n) => ({
          "@type": "Question",
          name: t(`station.faq.q${n}`, { station: name }),
          acceptedAnswer: { "@type": "Answer", text: t(`station.faq.a${n}`, { station: name }) },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "MRT Time", item: `${base}${localePath(locale, "/")}` },
          { "@type": "ListItem", position: 2, name, item: `${base}${localePath(locale, `/station/${station.slug}`)}` },
        ],
      },
    ],
  };
}

/** Safe JSON for a <script type="application/ld+json"> tag. */
export function jsonLdString(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export const SEO_STATIONS = STATIONS.filter((s) => s.seo);
export const PUBLIC_PATHS = ["/", "/plan", "/accuracy", "/media-kit", "/about", "/privacy", "/terms", "/submit"];
