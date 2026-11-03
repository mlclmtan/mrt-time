import type { MetadataRoute } from "next";
import { localePath } from "@/lib/i18n";
import { appUrl, PUBLIC_PATHS } from "@/lib/seo";
import { STATIONS } from "@/lib/network/data";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const paths = [...PUBLIC_PATHS, ...STATIONS.map((s) => `/station/${s.slug}`)];
  return paths.map((path) => ({
    url: `${base}${localePath("en", path)}`,
    changeFrequency: path.startsWith("/station/") || path === "/" ? "hourly" : "weekly",
    priority: path === "/" ? 1 : path.startsWith("/station/") ? 0.8 : 0.5,
    alternates: {
      languages: {
        "en-SG": `${base}${localePath("en", path)}`,
        "zh-Hant": `${base}${localePath("zh-Hant", path)}`,
      },
    },
  }));
}
