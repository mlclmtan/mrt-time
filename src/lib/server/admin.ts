import { sgtDate, sgtInstant, DAY } from "../time";
import type { Range } from "../analytics/aggregates";
import type { UnstableWindow } from "../predict";

/** Date range from YYYY-MM-DD params (SGT, inclusive end), default last 28 days. */
export function parseRange(from: string | null | undefined, to: string | null | undefined, now = Date.now()): Range & { fromDate: string; toDate: string } {
  const ok = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const toDate = ok(to) ?? sgtDate(now);
  const fromDate = ok(from) ?? sgtDate(now - 27 * DAY);
  const start = sgtInstant(fromDate, "00:00");
  const end = sgtInstant(toDate, "00:00") + DAY;
  return { from: new Date(Math.min(start, end - DAY)), to: new Date(end), fromDate, toDate };
}

/** "weekday 09:15-10:30 [EWL]" per line. */
export function parseWindows(text: string): UnstableWindow[] {
  const out: UnstableWindow[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(weekday|weekend|all)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})(?:\s+(EWL|TEL|NEL))?\s*$/i.exec(line);
    if (m) out.push({ dayType: m[1].toLowerCase() as UnstableWindow["dayType"], start: m[2], end: m[3], line: m[4]?.toUpperCase() ?? null });
  }
  return out;
}

