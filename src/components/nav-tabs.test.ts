import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDateRange } from "@/lib/format";
import { centredScroll, fadeEdges, isActiveTab } from "./nav-tabs";
import { BrandMark } from "./brand-mark";

describe("v2.2 header and phone tab row", () => {
  it("a clipped tab always has a hint: the hiding edge fades; the current tab is centred", () => {
    // 393 px wide row, 560 px of tabs.
    expect(fadeEdges(0, 393, 560)).toBe("right");
    expect(fadeEdges(80, 393, 560)).toBe("both");
    expect(fadeEdges(167, 393, 560)).toBe("left");
    expect(fadeEdges(0, 393, 380)).toBe("none");
    // The 5th tab (at 470 px, 90 px wide) scrolls into the middle, clamped to the row.
    expect(centredScroll(470, 90, 393, 560)).toBe(167);
    expect(centredScroll(20, 60, 393, 560)).toBe(0);
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.nav-fade\[data-fade="right"\]\s*\{[^}]*mask-image/);
    expect(css).toMatch(/\.nav-fade\[data-fade="both"\]\s*\{[^}]*mask-image/);
  });

  it("the header shows a static brand mark (no '3 min' countdown look) and keeps the app name", () => {
    const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
    expect(shell).not.toContain("3 min");
    expect(shell).toContain("<BrandMark />");
    expect(shell).toContain('t("app.name")');
    const mark = renderToStaticMarkup(createElement(BrandMark));
    expect(mark).toContain("data-brand-mark");
    expect(mark.replace(/<[^>]+>/g, "")).toBe(""); // no text, no number
    expect(readFileSync(new URL("../lib/og.tsx", import.meta.url), "utf8")).not.toContain("3 min");
  });
});

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
