/** Map first-party events to GA4 params (custom dimensions) and Meta events. */
import type { EventName } from "./events";

export type UserType = "owner" | "analyst" | "visitor";
export type EventContext = {
  language?: string;
  standalone?: boolean;
  userType?: UserType;
  experiments?: Record<string, string>;
  kolHandle?: string | null;
  campaign?: string | null;
};

/** GA4 custom dimensions registered in docs/ga4-setup.md. */
export const GA4_DIMENSIONS = [
  "station",
  "line",
  "direction",
  "journey_type",
  "confidence",
  "standalone",
  "language",
  "user_type",
  "experiment_id",
  "variant",
  "kol_handle",
  "campaign",
  "traffic_type",
  "data_source",
  "creative_id",
  "format",
  "placement",
] as const;

export function ga4Params(name: EventName, props: Record<string, unknown>, ctx: EventContext) {
  const params: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props))
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") params[k] = v;
  if (ctx.language) params.language = ctx.language;
  if (ctx.standalone != null) params.standalone = ctx.standalone ? "yes" : "no";
  if (ctx.userType) params.user_type = ctx.userType;
  if (ctx.userType === "owner" || ctx.userType === "analyst") params.traffic_type = "internal";
  if (ctx.kolHandle && !params.kol_handle) params.kol_handle = ctx.kolHandle;
  if (ctx.campaign && !params.campaign) params.campaign = ctx.campaign;
  // The first experiment flattened for reporting (all are in experiment_exposure).
  const firstExp = ctx.experiments && Object.entries(ctx.experiments)[0];
  if (firstExp && name !== "experiment_exposure") {
    params.experiment_id = firstExp[0];
    params.variant = firstExp[1];
  }
  return params;
}

export type MetaEvent = { event: string; custom: boolean; data: Record<string, unknown> };

/** Pixel/CAPI events: PageView, ViewContent, Lead, CompleteRegistration, PlanJourney. */
export function metaEventFor(name: EventName, props: Record<string, unknown>): MetaEvent | null {
  switch (name) {
    case "page_view":
      return { event: "PageView", custom: false, data: {} };
    case "station_view":
      return { event: "ViewContent", custom: false, data: { content_type: "station", content_ids: [props.station] } };
    case "newsletter_signup":
      return { event: "Lead", custom: false, data: {} };
    case "app_installed":
      return { event: "CompleteRegistration", custom: false, data: { status: "installed" } };
    case "planner_query":
      return { event: "PlanJourney", custom: true, data: { mode: props.mode, transfers: props.transfers } };
    default:
      return null;
  }
}
