/**
 * Backfill the PRACTICE GA4 property with synthetic data. Measurement
 * Protocol accepts timestamps up to 72 h back, so this sends the last
 * 3 SGT days (events older than the window are dropped) and the daily
 * cron grows it from there.
 *
 *   pnpm sandbox:seed            # send (needs GA_SANDBOX_* env)
 *   pnpm sandbox:seed --dry-run  # generate and print counts only
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
import { runSandbox } from "../src/lib/sandbox/run";
import { sgtDate, DAY } from "../src/lib/time";

const now = Date.now();
const dryRun = process.argv.includes("--dry-run");
// Complete past days only; the daily cron sends each new day once (days already sent are skipped).
const dates = [3, 2, 1].map((d) => sgtDate(now - d * DAY));
runSandbox({ dates, now, mode: "script", dryRun })
  .then((results) => {
    for (const r of results) console.log(`${r.day}: ${r.users} users, ${r.events} events, ${r.requests} requests — ${r.status}${r.error ? ` (${r.error})` : ""}`);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
