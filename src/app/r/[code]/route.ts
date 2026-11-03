import { eq } from "drizzle-orm";
import { dbConfigured, getDb } from "@/lib/db";
import { kol } from "@/lib/db/schema";

/** Referral code → the creator's landing page (code_used=1). */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const origin = new URL(request.url).origin;
  if (!dbConfigured() || !/^[A-Za-z0-9_-]{2,32}$/.test(code)) return Response.redirect(new URL("/", origin), 302);
  const found = await getDb()
    .query.kol.findFirst({ where: eq(kol.code, code.toUpperCase()) })
    .catch(() => null);
  return Response.redirect(new URL(found?.active ? `/k/${found.handle}?code=1` : "/", origin), 302);
}
