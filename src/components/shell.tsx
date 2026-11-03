import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";
import type { Role } from "@/lib/auth/access";
import { LanguageSwitch } from "./language-switch";
import { UpdateBanner, VersionTag } from "./update-banner";

export async function SiteHeader({ role }: { role: Role | null }) {
  const { locale, t } = await getT();
  const href = (p: string) => localePath(locale, p);
  const links: [string, string][] = [
    ["/plan", t("nav.plan")],
    ["/#stations", t("nav.stations")],
    ["/accuracy", t("nav.accuracy")],
    ["/submit", t("nav.submit")],
  ];
  if (role === "owner") links.push(["/me", t("nav.me")]);
  if (role) links.push(["/admin", t("nav.admin")]);
  links.push(["/settings", t("nav.settings")]);
  return (
    <header className="sticky top-0 z-30 -mx-4 border-b border-line bg-bg/90 px-4 backdrop-blur">
      <UpdateBanner />
      <div className="flex items-center gap-3 py-3">
        <Link href={href("/")} className="flex items-center gap-2 font-bold tracking-tight">
          <span className="led rounded-md border border-line bg-panel px-1.5 py-0.5 text-sm">3 min</span>
          <span>{t("app.name")}</span>
        </Link>
        <nav aria-label="Main" className="ml-auto hidden items-center gap-4 text-sm text-muted sm:flex">
          {links.map(([path, label]) => (
            <Link key={path} href={href(path)} className="hover:text-ink">
              {label}
            </Link>
          ))}
        </nav>
        <LanguageSwitch />
      </div>
      <nav aria-label="Main mobile" className="-mx-1 flex gap-3 overflow-x-auto pb-2 text-sm text-muted sm:hidden">
        {links.map(([path, label]) => (
          <Link key={path} href={href(path)} className="shrink-0 rounded-full border border-line px-3 py-1">
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export async function SiteFooter() {
  const { locale, t } = await getT();
  const href = (p: string) => localePath(locale, p);
  return (
    <footer className="safe-bottom border-t border-line py-6 text-xs text-muted">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link href={href("/about")}>{t("nav.about")}</Link>
        <Link href={href("/accuracy")}>{t("nav.accuracy")}</Link>
        <Link href={href("/media-kit")}>{t("nav.mediaKit")}</Link>
        <Link href={href("/privacy")}>{t("nav.privacy")}</Link>
        <Link href={href("/terms")}>{t("nav.terms")}</Link>
        <Link href={href("/sign-in")}>{t("nav.signIn")}</Link>
      </div>
      <VersionTag className="mt-3 block" />
    </footer>
  );
}
