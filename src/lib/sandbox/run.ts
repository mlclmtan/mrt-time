/** Shared by GET /api/cron/sandbox (daily) and scripts/sandbox-seed.ts (backfill). */
import { and, inArray } from "drizzle-orm";
import { dbConfigured, getDb } from "../db";
import { sandboxRun } from "../db/schema";
import { clampToMpWindow, generateDay } from "./generator";
import { productionMeasurementIds, sendPayloads } from "./sender";

export async function runSandbox(opts: { dates: string[]; now: number; mode: "cron" | "script"; dryRun?: boolean; fetchImpl?: typeof fetch }) {
  const results = [];
  // Never send a day twice (cron and backfill can overlap).
  const alreadySent = new Set<string>();
  if (dbConfigured() && !opts.dryRun) {
    const rows = await getDb()
      .select({ day: sandboxRun.day })
      .from(sandboxRun)
      .where(and(inArray(sandboxRun.day, opts.dates), inArray(sandboxRun.status, ["ok", "partial"])))
      .catch(() => []);
    for (const r of rows) alreadySent.add(r.day);
  }
  for (const date of opts.dates) {
    if (alreadySent.has(date)) {
      results.push({ day: date, users: 0, events: 0, requests: 0, status: "skipped", error: "already sent" });
      continue;
    }
    const day = generateDay(date);
    const payloads = clampToMpWindow(day.payloads, opts.now);
    let status = "ok";
    let error: string | null = null;
    let sent = { requests: 0, failed: 0, events: 0 };
    try {
      if (!opts.dryRun)
        sent = await sendPayloads(payloads, {
          measurementId: process.env.GA_SANDBOX_MEASUREMENT_ID,
          apiSecret: process.env.GA_SANDBOX_API_SECRET,
          production: productionMeasurementIds(),
          fetchImpl: opts.fetchImpl,
        });
      if (sent.failed) status = "partial";
    } catch (e) {
      status = "error";
      error = e instanceof Error ? e.message.slice(0, 200) : "error";
    }
    const summary = { day: date, users: day.users, events: opts.dryRun ? payloads.reduce((s, p) => s + p.events.length, 0) : sent.events, requests: sent.requests, status, error };
    if (dbConfigured() && !opts.dryRun)
      await getDb()
        .insert(sandboxRun)
        .values({ mode: opts.mode, ...summary })
        .catch(() => undefined);
    results.push(summary);
  }
  return results;
}
