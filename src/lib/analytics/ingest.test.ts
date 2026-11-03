import { describe, expect, it } from "vitest";
import { buildEventRow, serverPageHitRow } from "./ingest";

const headers = (extra: Record<string, string> = {}) =>
  new Headers({
    "user-agent": "Mozilla/5.0 (Linux; Android 15; Pixel) AppleWebKit Chrome/141.0 Mobile Safari/537.36",
    "x-vercel-ip-country": "SG",
    "x-vercel-ip-city": "Singapore",
    "x-forwarded-for": "203.0.113.7",
    ...extra,
  });
const base = {
  name: "station_view",
  props: { station: "orchard", line: "TEL" },
  event_id: "evt-12345678",
  device_id: "dev-12345678",
  session_id: "ses-12345678",
  route: "/station/orchard?utm_source=x",
  consent: { analytics: true, marketing: false },
};
const ctx = { userType: "visitor" as const, now: Date.parse("2026-11-02T02:00:00Z"), origin: "https://mrt.example" };

describe("event ingestion", () => {
  it("stores device/session ids only with analytics consent", () => {
    const yes = buildEventRow(base, { ...ctx, headers: headers() });
    expect(yes.ok && yes.row).toMatchObject({ deviceId: "dev-12345678", sessionId: "ses-12345678", aggregateOnly: false, route: "/station/orchard", country: "SG", city: "Singapore", deviceType: "mobile" });
    const no = buildEventRow({ ...base, consent: { analytics: false, marketing: false } }, { ...ctx, headers: headers() });
    expect(no.ok && no.row).toMatchObject({ deviceId: null, sessionId: null, aggregateOnly: true });
  });

  it("never stores the IP and rejects PII props and bots", () => {
    const ok = buildEventRow(base, { ...ctx, headers: headers() });
    expect(JSON.stringify(ok)).not.toContain("203.0.113.7");
    expect(buildEventRow({ ...base, props: { station: "orchard", email: "a@b.c" } }, { ...ctx, headers: headers() }).ok).toBe(false);
    expect(buildEventRow(base, { ...ctx, headers: headers({ "user-agent": "Googlebot/2.1" }) })).toEqual({ ok: false, error: "bot" });
  });

  it("server page hits are aggregate-only", () => {
    const row = serverPageHitRow({ path: "/about?x=1", headers: headers(), language: "en", now: ctx.now })!;
    expect(row).toMatchObject({ aggregateOnly: true, origin: "server", route: "/about", props: { page_type: "about" } });
    expect(row.deviceId).toBeUndefined();
  });
});
