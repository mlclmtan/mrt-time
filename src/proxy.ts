import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, LOCALE_HEADER, splitLocale } from "@/lib/i18n";
import { BUCKET_COOKIE } from "@/lib/analytics/experiments";
import { CONSENT_COOKIE, parseConsent } from "@/lib/analytics/consent";
import { serverPageHitRow } from "@/lib/analytics/ingest";

export const BUCKET_HEADER = "x-mrt-bucket";

/**
 * Count a page hit server-side only for visitors who granted no consent
 * (with any consent the client sends its own page_view).
 */
export function shouldLogHit(request: NextRequest) {
  if (request.method !== "GET" || !process.env.DATABASE_URL) return false;
  const h = request.headers;
  if (h.get("next-router-prefetch") || /prefetch/i.test(h.get("purpose") || h.get("sec-purpose") || "")) return false;
  const isDocument = (h.get("accept") || "").includes("text/html");
  if (!isDocument && h.get("rsc") !== "1") return false;
  if (/(^|;\s*)(__Secure-)?better-auth\.session_token=/.test(h.get("cookie") || "")) return false; // internal
  const consent = parseConsent(request.cookies.get(CONSENT_COOKIE)?.value);
  return !consent.analytics && !consent.marketing;
}

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, search } = request.nextUrl;
  const { locale: prefixed, path } = splitLocale(pathname);
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = prefixed ?? (isLocale(cookieLocale) ? cookieLocale : "en");

  const forwarded = new Headers(request.headers);
  forwarded.set(LOCALE_HEADER, locale);
  let bucket = request.cookies.get(BUCKET_COOKIE)?.value;
  const fresh = !bucket || !/^[a-z0-9-]{8,64}$/.test(bucket);
  if (fresh) bucket = crypto.randomUUID();
  forwarded.set(BUCKET_HEADER, bucket!);

  const response = prefixed
    ? NextResponse.rewrite(new URL(`${path}${search}`, request.url), { request: { headers: forwarded } })
    : NextResponse.next({ request: { headers: forwarded } });
  if (fresh)
    response.cookies.set(BUCKET_COOKIE, bucket!, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });

  if (shouldLogHit(request) && !path.startsWith("/admin")) {
    const row = serverPageHitRow({ path, headers: request.headers, language: locale, now: Date.now() });
    if (row)
      event.waitUntil(
        import("@/lib/db")
          .then(async ({ getDb }) => {
            const { eventLog } = await import("@/lib/db/schema");
            await getDb().insert(eventLog).values(row);
          })
          .catch(() => undefined),
      );
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|icons|sw.js|manifest.webmanifest|robots.txt|sitemap.xml|favicon.ico|.*\\.(?:png|svg|jpg|ico|txt|xml|json|js|css|webmanifest)$).*)",
  ],
};
