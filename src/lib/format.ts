import type { T, DictKey } from "./i18n";
import type { Prediction } from "./predict/types";
import { sgtClock } from "./time";
import { stationForCode } from "./network";

export const clock = (ms: number) => sgtClock(ms);

/** A platform code in reason params ("EW17") becomes the station name. */
export function reasonText(t: T, reason: Prediction["reason"], locale: "en" | "zh-Hant" = "en") {
  const params = { ...reason.params };
  if (typeof params.station === "string") params.station = stationForCode(params.station)?.name[locale] ?? params.station;
  return t(`reason.${reason.code}` as DictKey, params);
}

export function confidenceClass(c: Prediction["confidence"]) {
  return c === "high" ? "bg-go/15 text-go" : c === "medium" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad";
}

/** Whole minutes until `at` from `now` (0 = arriving). */
export function minsUntil(at: number, now: number) {
  return Math.max(0, Math.floor((at - now) / 60_000));
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/**
 * Unambiguous date range for "YYYY-MM-DD" SGT dates (no MM/DD confusion):
 * en → "7 Oct – 3 Nov 2026", zh-Hant → "2026年10月7日至11月3日".
 */
export function formatDateRange(fromDate: string, toDate: string, locale: "en" | "zh-Hant"): string {
  const parse = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return { y, m, d: day };
  };
  const a = parse(fromDate);
  const b = parse(toDate);
  if (![a.y, a.m, a.d, b.y, b.m, b.d].every(Number.isFinite)) return `${fromDate} – ${toDate}`;
  const same = fromDate === toDate;
  if (locale === "zh-Hant") {
    const full = (x: typeof a) => `${x.y}年${x.m}月${x.d}日`;
    if (same) return full(a);
    if (a.y !== b.y) return `${full(a)}至${full(b)}`;
    return `${full(a)}至${a.m === b.m ? "" : `${b.m}月`}${b.d}日`;
  }
  const en = (x: typeof a, year: boolean, month = true) => `${x.d}${month ? ` ${MONTHS_EN[x.m - 1]}` : ""}${year ? ` ${x.y}` : ""}`;
  if (same) return en(a, true);
  if (a.y !== b.y) return `${en(a, true)} – ${en(b, true)}`;
  return `${en(a, false, a.m !== b.m)} – ${en(b, true)}`;
}
