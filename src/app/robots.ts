import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const base = appUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/me", "/settings", "/sign-in", "/not-invited", "/k/", "/r/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
