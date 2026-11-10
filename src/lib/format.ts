import type { T, DictKey } from "./i18n";
import type { Prediction } from "./predict/types";
import { sgtClock } from "./time";
import { stationForCode } from "./network";

export const clock = (ms: number) => sgtClock(ms);

/**
 * A platform code in reason params ("EW17") becomes the station name; an
 * anchor's SGT date ("2026-11-02") becomes the day ("Mon 2 Nov").
 */
export function reasonText(t: T, reason: Prediction["reason"], locale: "en" | "zh-Hant" = "en") {
  const params = { ...reason.params };
  if (typeof params.station === "string") params.station = stationForCode(params.station)?.name[locale] ?? params.station;
  if (reason.code === "historical_anchor") params.day = dayText(t, params.date, locale);
  return t(`reason.${reason.code}` as DictKey, params);
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
/** "YYYY-MM-DD" (SGT) → en "Mon 2 Nov", zh-Hant "11月2日（週一）". */
export function formatDay(date: string, locale: "en" | "zh-Hant"): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return locale === "zh-Hant" ? `${mo}月${d}日（週${WEEKDAYS_ZH[wd]}）` : `${WEEKDAYS_EN[wd]} ${d} ${MONTHS_EN[mo - 1]}`;
}
/** The named day of an anchor, or "another day" when unknown. */
export function dayText(t: T, date: unknown, locale: "en" | "zh-Hant"): string {
  return (typeof date === "string" && formatDay(date, locale)) || t("day.another");
}

/** "±1 min" — every ± carries its unit. */
export function plusMinusText(t: T, n: number): string {
  return t("board.pm", { n });
}

export function confidenceClass(c: Prediction["confidence"]) {
  return c === "high" ? "bg-go/15 text-go" : c === "medium" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad";
}

/** Whole minutes until `at` from `now` (0 = arriving). */
export function minsUntil(at: number, now: number) {
  return Math.max(0, Math.floor((at - now) / 60_000));
}

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
