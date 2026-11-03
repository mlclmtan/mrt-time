/** Public-reading moderation: auto-approve readings that agree with known data. */
import { MINUTE } from "../time";
import { readingHeadway } from "./bands";
import type { Observation, ReadingStatus } from "./types";

export const CONSISTENCY_TOLERANCE_MIN = 2;
export const CONSISTENCY_WINDOW_MIN = 30;

/** Arrival instants a reading implies, stepped by its headway around `at`. */
function impliedArrivals(obs: Observation, around: number): number[] {
  const shown = obs.minutes.map((m) => obs.capturedAt + m * MINUTE);
  const headway = readingHeadway(obs);
  if (!headway) return shown;
  const out = [...shown];
  const span = CONSISTENCY_WINDOW_MIN + 15;
  for (let t = shown[shown.length - 1] + headway * MINUTE; t <= around + span * MINUTE; t += headway * MINUTE)
    out.push(t);
  for (let t = shown[0] - headway * MINUTE; t >= around - span * MINUTE; t -= headway * MINUTE) out.push(t);
  return out;
}

export type Candidate = Pick<Observation, "station" | "line" | "direction" | "capturedAt" | "minutes">;

/**
 * Approved when the candidate's next train lands within ±2 min of a train
 * implied by an approved reading for the same platform taken within the same
 * 30-min window (or of a predicted same-day arrival); pending otherwise.
 */
export function autoApprovalStatus(
  candidate: Candidate,
  approved: Observation[],
  predictedArrivals: number[] = [],
): ReadingStatus {
  if (!candidate.minutes.length) return "pending";
  const next = candidate.capturedAt + candidate.minutes[0] * MINUTE;
  const tol = CONSISTENCY_TOLERANCE_MIN * MINUTE;
  const peers = approved.filter(
    (o) =>
      o.status === "approved" &&
      o.station === candidate.station &&
      o.line === candidate.line &&
      o.direction === candidate.direction &&
      Math.abs(o.capturedAt - candidate.capturedAt) <= CONSISTENCY_WINDOW_MIN * MINUTE,
  );
  const consistent =
    peers.some((o) => impliedArrivals(o, candidate.capturedAt).some((t) => Math.abs(t - next) <= tol)) ||
    predictedArrivals.some((t) => Math.abs(t - next) <= tol);
  return consistent ? "approved" : "pending";
}

/* ---------- Rate limiting (device + daily IP hash) ---------- */

export const PUBLIC_READING_LIMIT = 10;
export const RATE_WINDOW_MS = 60 * MINUTE;

export function rateLimitKey(deviceId: string | null | undefined, ipHash: string | null | undefined) {
  return `${(deviceId || "nodevice").slice(0, 64)}:${(ipHash || "noip").slice(0, 64)}`;
}

export interface RateLimiter {
  /** Records one hit and says whether it is allowed. */
  hit(key: string, now: number): Promise<{ allowed: boolean; remaining: number }>;
}

/** In-memory sliding window (tests and single-instance fallback). */
export class MemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private limit = PUBLIC_READING_LIMIT,
    private windowMs = RATE_WINDOW_MS,
  ) {}
  async hit(key: string, now: number) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0 };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.limit - recent.length };
  }
}
