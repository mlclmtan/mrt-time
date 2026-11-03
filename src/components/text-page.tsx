import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import type { DictKey } from "@/lib/i18n";

export function textPage(path: string, titleKey: DictKey, bodyKey: DictKey) {
  async function generateMetadata(): Promise<Metadata> {
    const { locale, t } = await getT();
    return pageMetadata({ locale, path, title: t(titleKey), description: t(bodyKey).slice(0, 160) });
  }
  async function Page() {
    const { t } = await getT();
    return (
      <article className="max-w-2xl space-y-4 pt-6">
        <h1 className="text-3xl font-bold">{t(titleKey)}</h1>
        <p className="leading-relaxed text-muted">{t(bodyKey)}</p>
      </article>
    );
  }
  return { generateMetadata, Page };
}
