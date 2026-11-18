"use client";
import { useState } from "react";
import { Share2 } from "lucide-react";
import { shareUrl } from "@/lib/analytics/utm";
import { useAnalytics } from "./analytics/analytics-provider";
import { useI18n } from "./i18n";

/** Web Share API with UTM; falls back to copying the link. */
export function ShareButton({
  path,
  title,
  contentType,
  iconOnly = false,
}: {
  path: string;
  title: string;
  contentType: "station" | "journey" | "app" | "media_kit";
  iconOnly?: boolean;
}) {
  const { t } = useI18n();
  const { track } = useAnalytics();
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = shareUrl(location.origin, path, contentType);
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        track("share", { method: "web_share", content_type: contentType });
      } catch {
        /* cancelled */
      }
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => {});
    track("share", { method: "copy", content_type: contentType });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={() => void share()}
        aria-label={copied ? t("share.copied") : t("share.cta")}
        title={copied ? t("share.copied") : t("share.cta")}
        className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-line bg-panel-2 text-muted hover:text-ink active:scale-95 transition-transform"
      >
        <Share2 size={18} aria-hidden />
      </button>
    );
  }

  return (
    <button type="button" onClick={() => void share()} className="btn btn-secondary py-2 text-sm">
      <Share2 size={15} aria-hidden /> {copied ? t("share.copied") : t("share.cta")}
    </button>
  );
}
