import { dbConfigured } from "@/lib/db";
import { json } from "@/lib/server/http";
import { timed } from "@/lib/server/metrics";
import { serveAd } from "@/lib/server/ads";
import { isAdPlacement, AD_FORMATS, isAdFormat } from "@/lib/ads/formats";
import { coarseUa } from "@/lib/analytics/request";
import { getStation, PLATFORMS } from "@/lib/network";
import { isLocale } from "@/lib/i18n";

const SESSION = /^[a-zA-Z0-9-]{8,64}$/;

/**
 * GET /api/ads/serve?p=<placement>&station=<slug>&lang=en&s=<session>&f=<formats>
 * → { ad: AdView | null }. Targeting is contextual (station, line, language,
 * time band, device); pacing and the 3-per-session cap are applied here.
 */
export const GET = timed("/api/ads/serve", async (request) => {
  const q = new URL(request.url).searchParams;
  const placement = q.get("p");
  if (!isAdPlacement(placement)) return json({ error: "Unknown placement" }, 400);
  if (!dbConfigured()) return json({ ad: null });
  const station = getStation(q.get("station") || "");
  const lang = q.get("lang");
  const sid = q.get("s");
  const formats = (q.get("f") || "").split(",").filter(isAdFormat);
  const device = coarseUa(request.headers.get("user-agent")).deviceType;
  if (device === "bot") return json({ ad: null });
  const ad = await serveAd(
    {
      placement,
      station: station?.slug ?? null,
      lines: station ? [...new Set(station.codes.map((c) => PLATFORMS[c].line))] : [],
      language: isLocale(lang) ? lang : "en",
      device,
      now: Date.now(),
      formats: formats.length ? formats : [...AD_FORMATS],
    },
    sid && SESSION.test(sid) ? sid : null,
    new URL(request.url).origin,
  ).catch(() => null);
  return json({ ad });
});
