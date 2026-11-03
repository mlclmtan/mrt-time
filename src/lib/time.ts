/** Pure clock math. Instants are Unix ms; Singapore is UTC+08 all year. */
export const SECOND = 1000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const SGT_OFFSET = 8 * HOUR;
export const MINUTES_PER_DAY = 24 * 60;

/** "2026-10-26" in Singapore. */
export function sgtDate(instant: number): string {
  return new Date(instant + SGT_OFFSET).toISOString().slice(0, 10);
}
/** "08:20" in Singapore. */
export function sgtClock(instant: number): string {
  return new Date(instant + SGT_OFFSET).toISOString().slice(11, 16);
}
/** ISO weekday in Singapore: 1 = Monday … 7 = Sunday. */
export function sgtWeekday(instant: number): number {
  const day = new Date(instant + SGT_OFFSET).getUTCDay();
  return day === 0 ? 7 : day;
}
export function isWeekend(instant: number): boolean {
  return sgtWeekday(instant) >= 6;
}
export type DayType = "weekday" | "weekend";
export function dayType(instant: number): DayType {
  return isWeekend(instant) ? "weekend" : "weekday";
}
/** Minutes since SGT midnight (fractional). */
export function sgtMinuteOfDay(instant: number): number {
  const shifted = instant + SGT_OFFSET;
  return (((shifted % DAY) + DAY) % DAY) / MINUTE;
}
/** Minutes since SGT midnight for "HH:MM" (NaN when malformed). */
export function clockMinutes(clock: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clock);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}
/** The instant of SGT midnight starting the day that contains `instant`. */
export function sgtMidnight(instant: number): number {
  const shifted = instant + SGT_OFFSET;
  return shifted - (((shifted % DAY) + DAY) % DAY) - SGT_OFFSET;
}
/** The instant for an SGT calendar date and "HH:MM". */
export function sgtInstant(date: string, clock: string): number {
  const minutes = clockMinutes(clock);
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(minutes) || !Number.isFinite(midnight))
    throw new Error("Invalid SGT date or time");
  return midnight - SGT_OFFSET + minutes * MINUTE;
}
/** Smallest signed circular distance a−b between two minute-of-day values. */
export function circularDelta(a: number, b: number): number {
  let d = (((a - b) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (d > MINUTES_PER_DAY / 2) d -= MINUTES_PER_DAY;
  return d;
}
/** "HH:MM" for a minute-of-day value (wraps past midnight). */
export function clockFromMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function median(values: readonly (number | null | undefined)[]): number | null {
  const xs = values
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
/** Whole minutes from now until `at`, never negative. */
export function minutesUntil(at: number, now: number): number {
  return Math.max(0, Math.round((at - now) / MINUTE));
}
