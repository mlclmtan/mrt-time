import { adsTxtLine } from "@/lib/ads/adsense";

// Read the env per request so the file follows the deployment's settings.
export const dynamic = "force-dynamic";

/** /ads.txt — the AdSense seller line when NEXT_PUBLIC_ADSENSE_CLIENT is set, else 404. */
export function GET() {
  const line = adsTxtLine(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);
  if (!line) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(`${line}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
