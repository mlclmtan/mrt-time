/** Server-side request helpers: coarse UA, geo headers, salted daily IP hash. */
import { createHash } from "node:crypto";
import { sgtDate } from "../time";

export type CoarseUa = { browser: string; os: string; deviceType: "mobile" | "tablet" | "desktop" | "bot" };

export function coarseUa(ua: string | null | undefined): CoarseUa {
  const s = ua || "";
  const bot = /bot|crawler|spider|slurp|headless|lighthouse/i.test(s);
  const os = /iPhone|iPad|iPod/.test(s)
    ? "iOS"
    : /Android/.test(s)
      ? "Android"
      : /Mac OS X|Macintosh/.test(s)
        ? "macOS"
        : /Windows/.test(s)
          ? "Windows"
          : /CrOS/.test(s)
            ? "ChromeOS"
            : /Linux/.test(s)
              ? "Linux"
              : "Other";
  const browser = /Edg\//.test(s)
    ? "Edge"
    : /SamsungBrowser/.test(s)
      ? "Samsung"
      : /CriOS|Chrome\//.test(s)
        ? "Chrome"
        : /FxiOS|Firefox\//.test(s)
          ? "Firefox"
          : /Safari\//.test(s)
            ? "Safari"
            : "Other";
  const deviceType = bot
    ? "bot"
    : /iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))
      ? "tablet"
      : /Mobi|iPhone|Android/.test(s)
        ? "mobile"
        : "desktop";
  return { browser, os, deviceType };
}

/** Vercel geo headers: country / region / city only. */
export function geoFromHeaders(h: Headers) {
  const city = h.get("x-vercel-ip-city");
  return {
    country: h.get("x-vercel-ip-country")?.slice(0, 2) || null,
    region: h.get("x-vercel-ip-country-region")?.slice(0, 8) || null,
    city: city ? decodeURIComponent(city).slice(0, 60) : null,
  };
}

export function clientIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/**
 * Salted daily hash: the raw IP is never stored, and the salt rotates with
 * the SGT date so hashes can't be joined across days.
 */
export function dailyIpHash(ip: string | null, now: number, salt = process.env.IP_HASH_SALT || "mrt-time"): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${salt}|${sgtDate(now)}|${ip}`).digest("hex").slice(0, 32);
}
