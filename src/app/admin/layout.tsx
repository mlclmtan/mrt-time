import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const NAV: [string, DictKey, boolean][] = [
  ["/admin", "admin.overview", false],
  ["/admin/submissions", "admin.submissions", true],
  ["/admin/campaigns", "admin.campaigns", false],
  ["/admin/kols", "admin.kols", false],
  ["/admin/experiments", "admin.experiments", false],
  ["/admin/feedback", "admin.feedback", true],
  ["/admin/settings", "admin.settings", true],
];

/** Owners manage everything; analysts (ANALYST_EMAILS) get read-only analytics. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { t } = await getT();
  const owner = session.user.role === "owner";
  return (
    <div className="space-y-4 pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{t("admin.title")}</h1>
        {!owner && <span className="chip bg-accent/15 text-accent">{t("admin.readOnly")}</span>}
      </div>
      <nav className="flex flex-wrap gap-2 text-sm">
        {NAV.filter(([, , ownerOnly]) => owner || !ownerOnly).map(([href, key]) => (
          <Link key={href} href={href} className="rounded-full border border-line px-3 py-1">
            {t(key)}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
