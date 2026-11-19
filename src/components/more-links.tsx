import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";
import type { Role } from "@/lib/auth/access";

export async function MoreSection({ role }: { role: Role | null }) {
  const { locale, t } = await getT();
  const href = (p: string) => localePath(locale, p);

  const links: { href: string; label: string }[] = [
    { href: href("/accuracy"), label: t("nav.accuracy") },
    { href: href("/settings"), label: t("nav.settings") },
    { href: href("/about"), label: t("nav.about") },
    { href: href("/privacy"), label: t("nav.privacy") },
    { href: href("/terms"), label: t("nav.terms") },
  ];
  if (role) {
    links.push({ href: href("/admin"), label: t("nav.admin") });
  }

  return (
    <section className="panel space-y-2 p-4">
      {!role && (
        <Link
          href={href("/sign-in")}
          className="btn btn-primary flex min-h-[48px] w-full items-center justify-center text-base font-semibold"
        >
          {t("nav.signIn")}
        </Link>
      )}
      <h2 className="font-semibold">{t("more.title")}</h2>
      <div className="flex flex-col divide-y divide-line text-sm">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex min-h-[44px] items-center text-muted transition-colors hover:text-ink"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
