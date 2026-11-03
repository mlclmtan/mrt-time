/** First-party event ingestion into event_log (Neon). */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { device, eventLog } from "../db/schema";
import { cleanReferrer, cleanRoute, envelopeSchema, validateEvent, type Envelope } from "./events";
import { coarseUa, geoFromHeaders } from "./request";
import { metaEventFor, type UserType } from "./mapping";
import { capiConfigured, capiPayload, sendCapi } from "./meta-capi";

export type IngestResult = { ok: true; row: typeof eventLog.$inferInsert; capi?: Record<string, unknown> } | { ok: false; error: string };

/** Pure: validate an envelope and build the event_log row (+ optional CAPI body). */
export function buildEventRow(
  raw: unknown,
  ctx: { headers: Headers; userType: UserType; now: number; origin: string },
): IngestResult {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_envelope" };
  const env: Envelope = parsed.data;
  const event = validateEvent(env.name, env.props);
  if (!event.ok) return { ok: false, error: event.error };
  const consented = env.consent.analytics;
  const ua = coarseUa(ctx.headers.get("user-agent"));
  if (ua.deviceType === "bot") return { ok: false, error: "bot" };
  const geo = geoFromHeaders(ctx.headers);
  const row: typeof eventLog.$inferInsert = {
    ts: new Date(ctx.now),
    name: event.name,
    eventId: env.event_id,
    // Without analytics consent: aggregate-only (no device or session id).
    deviceId: consented ? (env.device_id ?? null) : null,
    sessionId: consented ? (env.session_id ?? null) : null,
    aggregateOnly: !consented,
    origin: "client",
    userType: ctx.userType,
    route: cleanRoute(env.route),
    referrer: cleanReferrer(env.referrer),
    props: event.props,
    utmSource: env.utm?.source ?? null,
    utmMedium: env.utm?.medium ?? null,
    utmCampaign: env.utm?.campaign ?? null,
    utmContent: env.utm?.content ?? null,
    utmTerm: env.utm?.term ?? null,
    kolHandle: env.kol_handle ?? null,
    viewport: env.viewport ?? null,
    standalone: env.standalone ?? null,
    language: env.language ?? null,
    experiments: env.experiments && Object.keys(env.experiments).length ? env.experiments : null,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    browser: ua.browser,
    os: ua.os,
    deviceType: ua.deviceType,
  };
  let capi: Record<string, unknown> | undefined;
  const meta = metaEventFor(event.name, event.props);
  if (meta && env.consent.marketing && capiConfigured())
    capi = capiPayload(
      meta,
      {
        eventId: env.event_id,
        eventTime: ctx.now,
        url: `${ctx.origin}${cleanRoute(env.route)}`,
        userAgent: ctx.headers.get("user-agent") || "",
        fbp: env.fbp,
        fbc: env.fbc,
      },
      process.env.META_TEST_EVENT_CODE?.trim() || undefined,
    );
  return { ok: true, row, capi };
}

export async function storeEvent(result: Extract<IngestResult, { ok: true }>) {
  const db = getDb();
  await db.insert(eventLog).values(result.row);
  const { deviceId, utmSource, utmMedium, utmCampaign, kolHandle, name } = result.row;
  if (deviceId) {
    const touch = utmSource ? { source: utmSource, medium: utmMedium, campaign: utmCampaign } : null;
    await db
      .insert(device)
      .values({ id: deviceId, firstTouch: touch, lastTouch: touch, kolHandle: kolHandle ?? null, installedAt: name === "app_installed" ? new Date() : null })
      .onConflictDoUpdate({
        target: device.id,
        set: {
          lastSeen: sql`now()`,
          lastTouch: touch ? sql`${JSON.stringify(touch)}::jsonb` : sql`${device.lastTouch}`,
          kolHandle: sql`coalesce(${device.kolHandle}, ${kolHandle ?? null})`,
          installedAt: name === "app_installed" ? sql`coalesce(${device.installedAt}, now())` : sql`${device.installedAt}`,
        },
      });
  }
  if (result.capi) await sendCapi(result.capi).catch(() => undefined);
}

/** Server-side page hit for visitors without analytics consent (aggregate only). */
export function serverPageHitRow(input: { path: string; headers: Headers; language: string; now: number }): typeof eventLog.$inferInsert | null {
  const ua = coarseUa(input.headers.get("user-agent"));
  if (ua.deviceType === "bot") return null;
  const geo = geoFromHeaders(input.headers);
  return {
    ts: new Date(input.now),
    name: "page_view",
    aggregateOnly: true,
    origin: "server",
    userType: "visitor",
    route: cleanRoute(input.path),
    referrer: cleanReferrer(input.headers.get("referer")),
    props: { page_type: "other" },
    language: input.language,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    browser: ua.browser,
    os: ua.os,
    deviceType: ua.deviceType,
  };
}
