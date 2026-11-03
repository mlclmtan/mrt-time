/**
 * Meta Conversions API (server side). Deduplicated with the browser Pixel
 * by sharing `event_id` (Pixel `eventID`). No PII: only the user agent and
 * the _fbp/_fbc cookies. No-op unless NEXT_PUBLIC_META_PIXEL_ID and
 * META_CAPI_TOKEN are set and the visitor granted marketing consent.
 */
import type { MetaEvent } from "./mapping";

export const META_GRAPH_VERSION = "v26.0";

export function capiConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() && process.env.META_CAPI_TOKEN?.trim());
}

export function capiPayload(
  meta: MetaEvent,
  input: { eventId: string; eventTime: number; url: string; userAgent: string; fbp?: string | null; fbc?: string | null },
  testEventCode?: string,
) {
  const userData: Record<string, string> = { client_user_agent: input.userAgent.slice(0, 400) };
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  const body: Record<string, unknown> = {
    data: [
      {
        event_name: meta.event,
        event_time: Math.floor(input.eventTime / 1000),
        event_id: input.eventId,
        action_source: "website",
        event_source_url: input.url,
        user_data: userData,
        custom_data: meta.data,
      },
    ],
  };
  if (testEventCode) body.test_event_code = testEventCode;
  return body;
}

export async function sendCapi(body: Record<string, unknown>, fetchImpl: typeof fetch = fetch) {
  if (!capiConfigured()) return { skipped: true as const };
  const pixel = process.env.NEXT_PUBLIC_META_PIXEL_ID!.trim();
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN!.trim())}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  return { skipped: false as const, ok: res.ok, status: res.status };
}
