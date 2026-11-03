/** Shared by GET /api/cron/sandbox (daily) and scripts/sandbox-seed.ts (backfill). */
import { dbConfigured, getDb } from "../db";
import { sandboxRun } from "../db/schema";
import { clampToMpWindow, generateDay } from "./generator";
import { productionMeasurementIds, sendPayloads } from "./sender";

export async function runSandbox(opts: { dates: string[]; now: number; mode: "cron" | "script"; dryRun?: boolean; fetchImpl?: typeof fetch }) {
  const results = [];
  for (const date of opts.dates) {
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
