import { describe, expect, it } from "vitest";
import { formatDateRange } from "@/lib/format";
import { isActiveTab } from "./nav-tabs";

describe("nav active state", () => {
  it("matches the current page, locale-aware, never hash links", () => {
    expect(isActiveTab("/plan", "/plan")).toBe(true);
    expect(isActiveTab("/zh-Hant/plan", "/zh-Hant/plan")).toBe(true);
    expect(isActiveTab("/plan/", "/plan")).toBe(true);
    expect(isActiveTab("/accuracy", "/plan")).toBe(false);
    expect(isActiveTab("/", "/#stations")).toBe(false);
    expect(isActiveTab("/admin/kols", "/admin")).toBe(true);
    expect(isActiveTab("/admin/kols", "/admin", true)).toBe(false);
    expect(isActiveTab("/admin", "/admin", true)).toBe(true);
    expect(isActiveTab("/admin/kols", "/admin/kols", false)).toBe(true);
    expect(isActiveTab("/settings", "/")).toBe(false);
  });
});

describe("admin date range label", () => {
  it("spells out the range without MM/DD ambiguity", () => {
    expect(formatDateRange("2026-10-07", "2026-11-03", "en")).toBe("7 Oct – 3 Nov 2026");
    expect(formatDateRange("2026-11-01", "2026-11-03", "en")).toBe("1 – 3 Nov 2026");
    expect(formatDateRange("2025-12-07", "2026-01-03", "en")).toBe("7 Dec 2025 – 3 Jan 2026");
    expect(formatDateRange("2026-11-03", "2026-11-03", "en")).toBe("3 Nov 2026");
    expect(formatDateRange("2026-10-07", "2026-11-03", "zh-Hant")).toBe("2026年10月7日至11月3日");
    expect(formatDateRange("2026-11-01", "2026-11-03", "zh-Hant")).toBe("2026年11月1日至3日");
    expect(formatDateRange("2025-12-07", "2026-01-03", "zh-Hant")).toBe("2025年12月7日至2026年1月3日");
  });
});
