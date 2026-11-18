import { describe, expect, it } from "vitest";
import { getAppRedirectTarget } from "./app-redirect";
import manifest from "@/app/manifest";

describe("getAppRedirectTarget", () => {
  it("redirects the owner to /trip (locale-aware)", () => {
    expect(getAppRedirectTarget("owner", "en")).toBe("/trip");
    expect(getAppRedirectTarget("owner", "zh-Hant")).toBe("/zh-Hant/trip");
  });

  it("redirects visitors and non-owners to /stations (locale-aware)", () => {
    expect(getAppRedirectTarget(null, "en")).toBe("/stations");
    expect(getAppRedirectTarget(null, "zh-Hant")).toBe("/zh-Hant/stations");
    expect(getAppRedirectTarget(undefined, "en")).toBe("/stations");
    expect(getAppRedirectTarget("analyst", "en")).toBe("/stations");
    expect(getAppRedirectTarget("analyst", "zh-Hant")).toBe("/zh-Hant/stations");
  });

  it("manifest start_url points at /app", () => {
    const m = manifest();
    expect(m.start_url).toBe("/app");
  });
});
