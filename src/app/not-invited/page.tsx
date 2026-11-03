import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NotInvited() {
  const { locale, t } = await getT();
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-10">
      <h1 className="text-2xl font-bold">{t("notInvited.title")}</h1>
      <p className="text-muted">{t("notInvited.body")}</p>
      <Link href={localePath(locale, "/")} className="btn btn-primary">
        {t("common.back")}
      </Link>
    </div>
  );
}
