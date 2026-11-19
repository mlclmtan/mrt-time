import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";
import { LanguageSwitch } from "./language-switch";
import { UpdateBanner, VersionTag } from "./update-banner";
import { BrandMark } from "./brand-mark";
import { FeedbackLink } from "./voc/feedback-widget";

export { AppMain } from "./app-main";

export async function SiteHeader({ signedIn = false }: { signedIn?: boolean } = {}) {
  const { locale, t } = await getT();
  const href = (p: string) => localePath(locale, p);
  return (
    <header className="safe-top shrink-0 border-b border-line bg-bg px-4">
      <UpdateBanner />
      <div className="flex items-center justify-between gap-3 py-3">
        <Link href={href("/")} className="flex items-center gap-2 font-bold tracking-tight">
          <BrandMark />
          <span>{t("app.name")}</span>
        </Link>
        <div className="flex items-center gap-2">
          {!signedIn && (
            <Link
              href={href("/sign-in")}
              className="inline-flex min-h-[36px] items-center rounded-full bg-led px-3.5 text-sm font-semibold text-[#0f1316] active:scale-95"
            >
              {t("nav.signIn")}
            </Link>
          )}
          <LanguageSwitch />
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const { locale, t } = await getT();
  const href = (p: string) => localePath(locale, p);
  return (
    <footer className="site-footer safe-bottom border-t border-line py-6 text-xs text-muted">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link href={href("/about")}>{t("nav.about")}</Link>
        <Link href={href("/accuracy")}>{t("nav.accuracy")}</Link>
        <Link href={href("/media-kit")}>{t("nav.mediaKit")}</Link>
        <Link href={href("/privacy")}>{t("nav.privacy")}</Link>
        <Link href={href("/terms")}>{t("nav.terms")}</Link>
        <Link href={href("/sign-in")}>{t("nav.signIn")}</Link>
        <FeedbackLink className="text-left" />
      </div>
      <VersionTag className="mt-3 block" />
    </footer>
  );
}
