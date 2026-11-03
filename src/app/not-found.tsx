import Link from "next/link";
import { getT } from "@/lib/i18n/server";
import { localePath } from "@/lib/i18n";

export default async function NotFound() {
  const { locale, t } = await getT();
  return (
    <div className="space-y-4 pt-10">
      <p className="led text-6xl font-bold">404</p>
      <h1 className="text-2xl font-bold">{t("notFound.title")}</h1>
      <Link href={localePath(locale, "/")} className="btn btn-primary">
        {t("common.back")}
      </Link>
    </div>
  );
}
