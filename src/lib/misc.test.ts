import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { shouldLogHit } from "@/proxy";
import { pageTypeFor } from "./analytics/page-type";
import { shouldPromptNps, NPS_COOLDOWN_MS } from "./analytics/nps";
import { parseRange, parseWindows } from "./server/admin";
import { disruptionMessage } from "./push/disruptions";
import { resolveBuildInfo, updateAvailable, versionLabel } from "./build-info";

describe("proxy page-hit logging", () => {
  const req = (headers: Record<string, string>) => new NextRequest("https://mrt.example/plan", { headers: { accept: "text/html", ...headers } });
  it("logs anonymous document hits only without any consent", () => {
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://x";
    try {
      expect(shouldLogHit(req({}))).toBe(true);
      expect(shouldLogHit(req({ cookie: "mrt_consent=v1.a1.m0.1700000000" }))).toBe(false);
      expect(shouldLogHit(req({ cookie: "mrt_consent=v1.a0.m1.1700000000" }))).toBe(false);
      expect(shouldLogHit(req({ cookie: "mrt_consent=v1.a0.m0.1700000000" }))).toBe(true);
      expect(shouldLogHit(req({ "next-router-prefetch": "1" }))).toBe(false);
      expect(shouldLogHit(req({ cookie: "better-auth.session_token=abc" }))).toBe(false);
      expect(shouldLogHit(new NextRequest("https://mrt.example/x.png", { headers: { accept: "image/png" } }))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
    }
    expect(shouldLogHit(req({}))).toBe(false); // no database → no logging
  });
});

describe("small helpers", () => {
  it("page types", () => {
    expect(pageTypeFor("/", "visitor")).toBe("landing");
    expect(pageTypeFor("/", "owner")).toBe("owner_home");
    expect(pageTypeFor("/station/orchard")).toBe("station");
    expect(pageTypeFor("/k/trainfan")).toBe("kol");
    expect(pageTypeFor("/nope")).toBe("other");
  });
  it("NPS after the 3rd visit, at most once per 30 days", () => {
    expect(shouldPromptNps({ visits: 2, promptedAt: null }, 0)).toBe(false);
    expect(shouldPromptNps({ visits: 3, promptedAt: null }, 0)).toBe(true);
    expect(shouldPromptNps({ visits: 9, promptedAt: 1000 }, 1000 + NPS_COOLDOWN_MS - 1)).toBe(false);
    expect(shouldPromptNps({ visits: 9, promptedAt: 1000 }, 1000 + NPS_COOLDOWN_MS)).toBe(true);
  });
  it("admin ranges and unstable-window editing", () => {
    const r = parseRange("2026-11-01", "2026-11-02");
    expect(r.from.toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(parseRange("bad", null, Date.parse("2026-11-03T04:00:00Z")).toDate).toBe("2026-11-03");
    expect(parseWindows("weekday 09:15-10:30\nweekend 07:00 - 08:00 TEL\ngarbage")).toEqual([
      { dayType: "weekday", start: "09:15", end: "10:30", line: null },
      { dayType: "weekend", start: "07:00", end: "08:00", line: "TEL" },
    ]);
  });
  it("disruption pushes only for journey lines, de-duplicated by hash", () => {
    const alerts = { status: 2 as const, segments: [{ line: "EWL", direction: "Both", stations: ["EW16", "EW17"] }], messages: [{ content: "Train fault.", createdDate: "" }] };
    const hit = disruptionMessage(alerts, ["EWL", "TEL"])!;
    expect(hit.message.title).toBe("EWL disruption");
    expect(hit.message.body).toContain("bus.91208274.xyz");
    expect(disruptionMessage(alerts, ["TEL"])).toBeNull();
    expect(disruptionMessage(alerts, ["EWL"])!.hash).toBe(hit.hash);
  });
  it("build info and version label", () => {
    const b = resolveBuildInfo({ version: "1.0.0", vercelSha: "ABCDEF1234", gitSha: () => null, now: new Date("2026-11-03T06:05:00Z") });
    expect(versionLabel(b)).toBe("v1.0.0 · abcdef1 · 3 Nov 14:05 SGT");
    expect(updateAvailable(b.buildId, "1.0.1+abc.x")).toBe(true);
    expect(updateAvailable(b.buildId, b.buildId)).toBe(false);
    expect(updateAvailable("dev", "1.0.1+abc.x")).toBe(false);
  });
});

describe("security headers", () => {
  it("allow geolocation for this origin only (the GPS station chip)", async () => {
    const { readFileSync } = await import("node:fs");
    const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
    const policy = /Permissions-Policy", value: "([^"]+)"/.exec(config)?.[1] ?? "";
    expect(policy).toContain("geolocation=(self)");
    expect(policy).not.toMatch(/geolocation=\(\)/);
    expect(policy).toContain("camera=()");
  });
});
