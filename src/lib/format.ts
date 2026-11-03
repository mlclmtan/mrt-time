import type { T, DictKey } from "./i18n";
import type { Prediction } from "./predict/types";
import { sgtClock } from "./time";

export const clock = (ms: number) => sgtClock(ms);

export function reasonText(t: T, reason: Prediction["reason"]) {
  return t(`reason.${reason.code}` as DictKey, reason.params);
}

export function confidenceClass(c: Prediction["confidence"]) {
  return c === "high" ? "bg-go/15 text-go" : c === "medium" ? "bg-warn/15 text-warn" : "bg-bad/15 text-bad";
}

/** Whole minutes until `at` from `now` (0 = arriving). */
export function minsUntil(at: number, now: number) {
  return Math.max(0, Math.floor((at - now) / 60_000));
}
