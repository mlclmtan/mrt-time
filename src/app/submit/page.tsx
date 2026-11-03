import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { ReadingForm } from "@/components/reading-form";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/submit", title: t("reading.title"), description: t("reading.intro") });
}

export default async function SubmitPage() {
  const { t } = await getT();
  return (
    <div className="space-y-4 pt-6">
      <h1 className="text-3xl font-bold">{t("reading.title")}</h1>
      <p className="text-muted">{t("reading.intro")}</p>
      <ReadingForm />
    </div>
  );
}
