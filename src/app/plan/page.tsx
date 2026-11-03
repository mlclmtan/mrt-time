import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/seo";
import { STATIONS } from "@/lib/network/data";
import { getStation } from "@/lib/network";
import { Planner } from "@/components/plan/planner";

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getT();
  return pageMetadata({ locale, path: "/plan", title: t("plan.title"), description: t("landing.planner"), image: "/opengraph-image" });
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, t } = await getT();
  const q = await searchParams;
  const pick = (v: unknown, fallback: string) => (typeof v === "string" && getStation(v) ? v : fallback);
  return (
    <div className="space-y-4 pt-6">
      <h1 className="text-3xl font-bold">{t("plan.title")}</h1>
      <Planner
        stations={STATIONS.map((s) => ({ slug: s.slug, name: s.name[locale] }))}
        defaultFrom={pick(q.from, "tiong-bahru")}
        defaultTo={pick(q.to, "shenton-way")}
      />
    </div>
  );
}
