/**
 * Synthetic ad cost CSV in GA4 cost-data-import format, for the practice
 * property only. Writes to stdout (or a file with --out path).
 *
 *   pnpm sandbox:cost --days 14 --out sandbox-cost.csv
 */
import { writeFileSync } from "node:fs";
import { costCsv, recentDates } from "../src/lib/sandbox/cost";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const days = Math.max(1, Math.min(90, Number(arg("--days") || 7)));
const csv = costCsv(recentDates(Date.now(), days), arg("--currency") || "SGD");
const out = arg("--out");
if (out) {
  writeFileSync(out, csv);
  console.log(`Wrote ${out} (${csv.trim().split("\n").length - 1} rows).`);
} else process.stdout.write(csv);
