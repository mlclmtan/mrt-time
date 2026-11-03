import { bearerMatches, json } from "@/lib/server/http";
import { runSandbox } from "@/lib/sandbox/run";
import { sandboxConfigured } from "@/lib/sandbox/sender";
import { sgtDate, DAY } from "@/lib/time";

export const maxDuration = 60;

/**
 * Vercel cron (daily, 00:30 SGT): send yesterday's synthetic day to the
 * PRACTICE GA4 property. Protected by CRON_SECRET (Vercel sends it as a
 * Bearer token). No-op unless the sandbox property is configured.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || !bearerMatches(request, process.env.CRON_SECRET))
    return json({ error: "Unauthorized" }, 401);
  if (!sandboxConfigured()) return json({ skipped: "sandbox not configured" });
  const now = Date.now();
  const results = await runSandbox({ dates: [sgtDate(now - DAY)], now, mode: "cron" });
  return json({ results });
}
