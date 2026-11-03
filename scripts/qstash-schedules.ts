/**
 * Create/replace the QStash schedule that checks LTA alerts for saved
 * journeys every 5 minutes during service hours (SGT 05:00–00:59).
 *
 *   pnpm qstash:schedules
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
import { qstashClient } from "../src/lib/push/qstash";
import { disruptionsUrl, schedulingAvailable } from "../src/lib/push/config";

async function main() {
  if (!schedulingAvailable()) throw new Error("Push/QStash env is incomplete (see .env.example).");
  const client = qstashClient();
  const destination = disruptionsUrl();
  for (const s of await client.schedules.list())
    if (s.destination === destination) await client.schedules.delete(s.scheduleId);
  // QStash cron is UTC: SGT 05:00–00:59 = UTC 21:00–16:59.
  const created = await client.schedules.create({ destination, cron: "*/5 0-16,21-23 * * *" });
  console.log(`Disruption checks scheduled: ${created.scheduleId}`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
