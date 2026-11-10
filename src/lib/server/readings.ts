/** Saving board readings from the owner, Hermes and the public form. */
import { z } from "zod";
import { getDb } from "../db";
import { observation } from "../db/schema";
import { DIRECTION_KEY_RE, PLATFORM_CODE_RE, getPlatform, isValidDirection } from "../network";
import { autoApprovalStatus, CONSISTENCY_WINDOW_MIN, PUBLIC_IP_LIMIT, PUBLIC_READING_LIMIT, hitPublicLimits } from "../predict/readings";
import type { ReadingSource, ReadingStatus } from "../predict";
import { MINUTE } from "../time";
import { observationStore } from "./observations";
import { platformPrediction } from "./board";
import { DbRateLimiter } from "./rate-limit";

export const readingInput = z
  .strictObject({
    station: z.string().regex(PLATFORM_CODE_RE),
    direction: z.string().regex(DIRECTION_KEY_RE),
    minutes: z.array(z.number().int().min(0).max(60)).min(1).max(3),
    capturedAt: z.string().datetime({ offset: true }).optional(),
    destination: z.string().max(40).optional(),
  })
  .refine((r) => r.minutes.every((m, i) => i === 0 || m >= r.minutes[i - 1]), "Minutes must not decrease");

export type ReadingInput = z.infer<typeof readingInput>;

/** Public readings may be dated at most this far back (UI allows 30; 2 min slack). */
export const PUBLIC_SEEN_AGO_MAX_MIN = 32;

/** The quick-entry body: exactly { station, direction, minutes[], seenAt }. */
export const readingPost = z.strictObject({
  station: z.string(),
  direction: z.string(),
  minutes: z.array(z.number()),
  seenAt: z.string().datetime({ offset: true }),
});

/** Accepts the flat quick-entry body or the legacy `{ deviceId, reading }` envelope. */
export function parseReadingBody(body: Record<string, unknown> | null): ReadingInput | null {
  if (!body) return null;
  if ("reading" in body) {
    const legacy = readingInput.safeParse(body.reading);
    return legacy.success ? legacy.data : null;
  }
  const flat = readingPost.safeParse(body);
  if (!flat.success) return null;
  const { seenAt, ...rest } = flat.data;
  const parsed = readingInput.safeParse({ ...rest, capturedAt: seenAt });
  return parsed.success ? parsed.data : null;
}

export function validPlatformDirection(station: string, direction: string) {
  const platform = getPlatform(station);
  return platform && isValidDirection(platform.line, direction) ? platform : null;
}

export async function saveReading(
  input: ReadingInput,
  meta: { source: ReadingSource; status?: ReadingStatus; userId?: string | null; deviceId?: string | null; ipHash?: string | null; origin?: string | null; now: number },
) {
  const platform = validPlatformDirection(input.station, input.direction);
  if (!platform) return { ok: false as const, error: "Unknown platform or direction" };
  const capturedAt = input.capturedAt ? Date.parse(input.capturedAt) : meta.now;
  if (capturedAt > meta.now + 2 * MINUTE || capturedAt < meta.now - 7 * 24 * 60 * MINUTE)
    return { ok: false as const, error: "Reading time out of range" };
  let status = meta.status;
  if (!status) {
    const peers = await observationStore(getDb()).near(input.station, platform.line, input.direction, capturedAt, CONSISTENCY_WINDOW_MIN * MINUTE);
    const predicted = await platformPrediction(input.station, input.direction, capturedAt).catch(() => null);
    const sameDay = predicted?.basis === "same_day" ? predicted.arrivals.map((a) => a.at) : [];
    status = autoApprovalStatus({ ...input, line: platform.line, capturedAt }, peers, sameDay);
  }
  const [row] = await getDb()
    .insert(observation)
    .values({
      station: input.station,
      line: platform.line,
      direction: input.direction,
      destination: input.destination ?? null,
      capturedAt: new Date(capturedAt),
      minutes: input.minutes,
      source: meta.source,
      status,
      origin: meta.origin ?? null,
      userId: meta.userId ?? null,
      deviceId: meta.deviceId ?? null,
      ipHash: meta.ipHash ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: observation.id });
  return { ok: true as const, id: row?.id ?? null, status, line: platform.line };
}

/** Public readings and sightings share both buckets: 10/h per device + network, 20/h per network. */
export async function publicRateLimit(deviceId: string | null, ipHash: string | null, now: number) {
  return hitPublicLimits(
    { device: new DbRateLimiter("public_reading", PUBLIC_READING_LIMIT), ip: new DbRateLimiter("public_ip", PUBLIC_IP_LIMIT) },
    deviceId,
    ipHash,
    now,
  );
}
export { PUBLIC_READING_LIMIT, PUBLIC_IP_LIMIT };
