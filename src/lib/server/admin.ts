import { sgtDate, sgtInstant, DAY } from "../time";
import type { Range } from "../analytics/aggregates";

/** Date range from YYYY-MM-DD params (SGT, inclusive end), default last 28 days. */
export function parseRange(from: string | null | undefined, to: string | null | undefined, now = Date.now()): Range & { fromDate: string; toDate: string } {
  const ok = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const toDate = ok(to) ?? sgtDate(now);
  const fromDate = ok(from) ?? sgtDate(now - 27 * DAY);
  const start = sgtInstant(fromDate, "00:00");
  const end = sgtInstant(toDate, "00:00") + DAY;
  return { from: new Date(Math.min(start, end - DAY)), to: new Date(end), fromDate, toDate };
}
