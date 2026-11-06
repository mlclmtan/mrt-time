/* eslint-disable @next/next/no-img-element -- creatives may be data URLs or any https image */
import type { AdFormat } from "@/lib/ads/formats";
import type { Locale } from "@/lib/i18n";

export type HouseAdData = {
  id: number;
  format: AdFormat;
  advertiser: string;
  headline: string;
  primaryText: string | null;
  description: string | null;
  image: string | null;
  ctaLabel: string;
  displayHost: string;
  clickUrl: string;
};

const LABEL: Record<Locale, { sponsored: string; ad: string }> = {
  en: { sponsored: "Sponsored", ad: "Ad" },
  "zh-Hant": { sponsored: "廣告", ad: "廣告" },
};

/**
 * One house ad drawn like its platform's native unit, always labelled
 * ("Sponsored" / "Ad" / "廣告"). The whole unit is one sponsored link.
 */
export function HouseAd({ ad, locale, onClick, preview = false }: { ad: HouseAdData; locale: Locale; onClick?: () => void; preview?: boolean }) {
  const label = LABEL[locale] ?? LABEL.en;
  const link = (children: React.ReactNode, className: string) =>
    preview ? (
      <div className={className}>{children}</div>
    ) : (
      <a href={ad.clickUrl} target="_blank" rel="sponsored noopener" onClick={onClick} className={className} data-ad-creative={ad.id}>
        {children}
      </a>
    );
  const initial = ad.advertiser.trim().charAt(0).toUpperCase() || "A";

  switch (ad.format) {
    case "meta_feed":
      return link(
        <>
          <div className="flex items-center gap-2 px-3 pt-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#1877f2] text-sm font-bold text-white">{initial}</span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">{ad.advertiser}</div>
              <div className="text-[11px] text-[#b0b3b8]">{label.sponsored} · 🌐</div>
            </div>
          </div>
          {ad.primaryText && <p className="line-clamp-2 px-3 pt-2 text-sm">{ad.primaryText}</p>}
          {ad.image && <img src={ad.image} alt="" className="mt-2 h-32 w-full object-cover" />}
          <div className="flex items-center gap-3 bg-[#3a3b3c] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] text-[#b0b3b8] uppercase">{ad.displayHost}</div>
              <div className="truncate text-sm font-semibold">{ad.headline}</div>
            </div>
            <span className="shrink-0 rounded-md bg-[#4e4f50] px-3 py-1.5 text-sm font-semibold">{ad.ctaLabel}</span>
          </div>
        </>,
        "block h-full w-full max-w-sm overflow-hidden rounded-lg bg-[#242526] text-[#e4e6eb]",
      );
    case "meta_story":
      return link(
        <>
          {ad.image ? <img src={ad.image} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-b from-[#833ab4] via-[#fd1d1d] to-[#fcb045]" />}
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/70" />
          <div className="absolute inset-x-2 top-2 h-0.5 rounded bg-white/40" />
          <div className="absolute top-4 left-2 flex items-center gap-1.5">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[11px] font-bold text-black">{initial}</span>
            <span className="text-[11px] leading-tight font-semibold">
              {ad.advertiser}
              <span className="block font-normal opacity-80">{label.sponsored}</span>
            </span>
          </div>
          <div className="absolute inset-x-2 bottom-3 space-y-2 text-center">
            <div className="text-sm leading-tight font-bold">{ad.headline}</div>
            <span className="inline-block rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">{ad.ctaLabel} ›</span>
          </div>
        </>,
        "relative block h-full w-[169px] overflow-hidden rounded-xl text-white",
      );
    case "google_display":
      return link(
        <>
          <span className="absolute top-0 right-0 rounded-bl bg-[#ffffffe6] px-1 text-[10px] text-[#4285f4]">{label.ad} ⓘ</span>
          {ad.image && <img src={ad.image} alt="" className="h-36 w-full object-cover" />}
          <div className="space-y-1 p-3">
            <div className="text-base leading-tight font-semibold text-[#202124]">{ad.headline}</div>
            {ad.description && <div className="line-clamp-2 text-xs text-[#5f6368]">{ad.description}</div>}
            <div className="flex items-center justify-between pt-1">
              <span className="truncate text-[11px] text-[#5f6368]">{ad.advertiser}</span>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#1a73e8] text-sm text-white">›</span>
            </div>
          </div>
        </>,
        "relative block h-full w-full max-w-sm overflow-hidden rounded-lg border border-[#dadce0] bg-white",
      );
    case "google_search_text":
      return link(
        <>
          <div className="text-xs font-bold text-[#e8eaed]">{label.sponsored}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#303134] text-xs font-bold text-[#e8eaed]">{initial}</span>
            <div className="leading-tight">
              <div className="text-sm text-[#dadce0]">{ad.advertiser}</div>
              <div className="text-xs text-[#bdc1c6]">https://{ad.displayHost}</div>
            </div>
          </div>
          <div className="mt-2 text-lg leading-snug text-[#8ab4f8] hover:underline">{ad.headline}</div>
          {ad.description && <p className="mt-1 line-clamp-3 text-sm text-[#bdc1c6]">{ad.description}</p>}
        </>,
        "block w-full max-w-md rounded-lg bg-[#202124] p-4",
      );
  }
}
