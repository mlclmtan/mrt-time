/**
 * Event taxonomy (mirrored to GA4 with the same names). Every prop is an
 * enum, a bounded number/boolean or a slug-like token: no PII and no free
 * text can pass these schemas. See docs/analytics.md.
 */
import { z } from "zod";
import { AD_FORMATS, AD_PLACEMENTS } from "../ads/formats";
import { DIRECTION_KEY_RE, LINE_CODE_LIST, PLATFORM_CODE_RE } from "../network/data";

const slug = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/);
const code = z.string().regex(PLATFORM_CODE_RE); // platform code e.g. EW17
const lineCode = z.enum(LINE_CODE_LIST);
const direction = z.string().regex(DIRECTION_KEY_RE);
const confidence = z.enum(["high", "medium", "low"]);
const platform = z.enum(["ios", "android", "desktop", "other"]);
const hostname = z.string().regex(/^[a-z0-9.-]{1,80}$/);

export const PAGE_TYPES = [
  "landing",
  "owner_home",
  "station",
  "planner",
  "accuracy",
  "media_kit",
  "about",
  "privacy",
  "terms",
  "submit",
  "settings",
  "admin",
  "kol",
  "sign_in",
  "other",
] as const;

export const TRIP_KINDS = [
  "door",
  "lift_lobby",
  "station_entrance",
  "tap_in",
  "at_platform",
  "board",
  "alight",
  "tap_out",
  "desk",
  "arrived",
] as const;

export const FEEDBACK_CATEGORIES = ["accuracy", "planner", "design", "bug", "idea", "other"] as const;

/** House-ad events (GA4 ad_impression / ad_viewable / ad_click). */
const adEvent = z.strictObject({
  creative_id: z.number().int().positive(),
  format: z.enum(AD_FORMATS),
  placement: z.enum(AD_PLACEMENTS),
  campaign: slug,
});

export const EVENT_SCHEMAS = {
  page_view: z.strictObject({ page_type: z.enum(PAGE_TYPES), station: slug.optional() }),
  station_view: z.strictObject({ station: slug, line: lineCode.optional() }),
  journey_view: z.strictObject({ journey_type: z.enum(["owner_saved", "public"]), journey_key: slug.optional() }),
  planner_query: z.strictObject({
    from_station: slug,
    to_station: slug,
    mode: z.enum(["depart", "leave_by", "list"]),
    transfers: z.number().int().min(0).max(2),
    journey_type: z.enum(["owner_saved", "public"]),
  }),
  prediction_view: z.strictObject({
    station: code,
    line: lineCode,
    direction,
    confidence,
    basis: z.enum(["same_day", "historical", "band", "closed", "none"]),
  }),
  prediction_feedback: z.strictObject({
    station: code,
    line: lineCode,
    direction,
    verdict: z.enum(["accurate", "early", "late"]),
  }),
  log_reading: z.strictObject({
    station: code,
    line: lineCode,
    direction,
    trains: z.number().int().min(1).max(3),
  }),
  log_trip_event: z.strictObject({ kind: z.enum(TRIP_KINDS), station: code.optional(), line: lineCode.optional() }),
  /** "I boarded" / "Got off" (owner or visitor). Minutes back = how far the time was moved back (0 = now). */
  boarded_logged: z.strictObject({
    /** Owner only: dropped for visitors (privacyProps). */
    station: code.optional(),
    line: lineCode,
    direction,
    minutes_back: z.number().int().min(0).max(720),
    user_type: z.enum(["owner", "visitor"]),
    status: z.enum(["approved", "pending", "rate_limited"]).optional(),
  }),
  alighted_logged: z.strictObject({
    station: code.optional(),
    line: lineCode,
    direction,
    minutes_back: z.number().int().min(0).max(720),
    user_type: z.enum(["owner", "visitor"]),
    status: z.enum(["approved", "pending", "rate_limited"]).optional(),
  }),
  timeline_edit: z.strictObject({ action: z.enum(["edit_time", "delete", "add_missed"]), kind: z.enum(TRIP_KINDS) }),
  stats_view: z.strictObject({ trips: z.number().int().min(0).max(100_000) }),
  /** GPS suggestion: only the suggested station slug, never coordinates. */
  geo_suggest_shown: z.strictObject({ station: slug.optional(), surface: z.enum(["home", "add", "boarding", "stations"]) }),
  geo_suggest_accepted: z.strictObject({ station: slug.optional(), surface: z.enum(["home", "add", "boarding", "stations"]) }),
  submit_reading: z.strictObject({
    station: code,
    line: lineCode,
    direction,
    status: z.enum(["approved", "pending", "rate_limited"]),
  }),
  install_prompt_shown: z.strictObject({ platform }),
  app_installed: z.strictObject({ platform }),
  standalone_open: z.strictObject({}),
  share: z.strictObject({
    method: z.enum(["web_share", "copy"]),
    content_type: z.enum(["station", "journey", "app", "media_kit"]),
  }),
  outbound_click: z.strictObject({ domain: hostname, link_type: z.enum(["bus", "lta", "other"]) }),
  alert_view: z.strictObject({ line: lineCode, status: z.number().int().min(1).max(2) }),
  crowd_view: z.strictObject({ station: code, line: lineCode, level: z.enum(["l", "m", "h", "NA"]) }),
  feedback_submit: z.strictObject({ rating: z.number().int().min(1).max(5), category: z.enum(FEEDBACK_CATEGORIES) }),
  nps_submit: z.strictObject({ score: z.number().int().min(0).max(10) }),
  newsletter_signup: z.strictObject({ double_opt_in: z.boolean() }),
  experiment_exposure: z.strictObject({ experiment_id: slug, variant: slug }),
  kol_landing: z.strictObject({ kol_handle: slug, code_used: z.boolean() }),
  campaign_landing: z.strictObject({ campaign: slug, source: slug, medium: slug }),
  consent_update: z.strictObject({ analytics: z.boolean(), marketing: z.boolean() }),
  ad_impression: adEvent,
  ad_viewable: adEvent,
  ad_click: adEvent,
  web_vital: z.strictObject({
    metric: z.enum(["LCP", "INP", "CLS", "TTFB", "FCP"]),
    value: z.number().min(0).max(600_000),
    rating: z.enum(["good", "needs-improvement", "poor"]),
  }),
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;
export type EventProps<N extends EventName> = z.infer<(typeof EVENT_SCHEMAS)[N]>;
export const EVENT_NAMES = Object.keys(EVENT_SCHEMAS) as EventName[];

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && value in EVENT_SCHEMAS;
}

export function validateEvent(name: unknown, props: unknown) {
  if (!isEventName(name)) return { ok: false as const, error: "unknown_event" };
  const parsed = EVENT_SCHEMAS[name].safeParse(props ?? {});
  return parsed.success
    ? { ok: true as const, name, props: parsed.data as Record<string, unknown> }
    : { ok: false as const, error: "invalid_props" };
}

/** Context sent with every first-party event (no PII). */
export const envelopeSchema = z.strictObject({
  name: z.string().max(40),
  props: z.record(z.string(), z.unknown()).optional(),
  event_id: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
  device_id: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/).nullish(),
  session_id: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/).nullish(),
  route: z.string().max(200),
  referrer: z.string().max(300).nullish(),
  utm: z
    .strictObject({
      source: slug.optional(),
      medium: slug.optional(),
      campaign: slug.optional(),
      content: slug.optional(),
      term: slug.optional(),
    })
    .nullish(),
  kol_handle: slug.nullish(),
  viewport: z.string().regex(/^\d{2,5}x\d{2,5}$/).nullish(),
  standalone: z.boolean().optional(),
  language: z.enum(["en", "zh-Hant"]).optional(),
  experiments: z.record(slug, slug).optional(),
  consent: z.strictObject({ analytics: z.boolean(), marketing: z.boolean() }),
  fbp: z.string().regex(/^fb\.\d\.\d+\.\d+$/).nullish(),
  fbc: z.string().regex(/^fb\.\d\.\d+\.[\w-]{1,200}$/).nullish(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

/** Path only: never store query strings (they can carry PII). */
export function cleanRoute(route: string) {
  return route.split(/[?#]/)[0].slice(0, 200) || "/";
}
/** Referrer reduced to origin + path. */
export function cleanReferrer(referrer: string | null | undefined) {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}
