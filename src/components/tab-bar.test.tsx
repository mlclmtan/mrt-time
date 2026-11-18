import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getActiveTabIndex, getTabBarTabs, TabBar } from "./tab-bar";
import { makeT } from "@/lib/i18n";

describe("TabBar active index calculation", () => {
  const t = makeT("en");
  const ownerTabs = getTabBarTabs("owner", t);
  const visitorTabs = getTabBarTabs(null, t);

  it("produces 5 tabs for owner and 4 tabs for visitors in correct order", () => {
    expect(ownerTabs.map((tab) => tab.key)).toEqual(["trip", "stations", "log", "plan", "me"]);
    expect(ownerTabs.map((tab) => tab.href)).toEqual(["/trip", "/stations", "/add", "/plan", "/me"]);

    expect(visitorTabs.map((tab) => tab.key)).toEqual(["stations", "plan", "log", "more"]);
    expect(visitorTabs.map((tab) => tab.href)).toEqual(["/stations", "/plan", "/add", "/settings"]);
  });

  it("calculates active index for owner tabs correctly (locale-aware, sub-routes, station pages)", () => {
    expect(getActiveTabIndex(ownerTabs, "/trip")).toBe(0);
    expect(getActiveTabIndex(ownerTabs, "/zh-Hant/trip")).toBe(0);
    expect(getActiveTabIndex(ownerTabs, "/")).toBe(0); // owner home
    expect(getActiveTabIndex(ownerTabs, "/stations")).toBe(1);
    expect(getActiveTabIndex(ownerTabs, "/zh-Hant/stations")).toBe(1);
    expect(getActiveTabIndex(ownerTabs, "/station/orchard")).toBe(1);
    expect(getActiveTabIndex(ownerTabs, "/zh-Hant/station/outram-park")).toBe(1);
    expect(getActiveTabIndex(ownerTabs, "/add")).toBe(2);
    expect(getActiveTabIndex(ownerTabs, "/zh-Hant/add")).toBe(2);
    expect(getActiveTabIndex(ownerTabs, "/plan")).toBe(3);
    expect(getActiveTabIndex(ownerTabs, "/zh-Hant/plan")).toBe(3);
    expect(getActiveTabIndex(ownerTabs, "/me")).toBe(4);
    expect(getActiveTabIndex(ownerTabs, "/zh-Hant/me")).toBe(4);
    expect(getActiveTabIndex(ownerTabs, "/me/stats")).toBe(4);
    expect(getActiveTabIndex(ownerTabs, "/settings")).toBe(-1);
    expect(getActiveTabIndex(ownerTabs, "/accuracy")).toBe(-1);
  });

  it("calculates active index for visitor tabs correctly", () => {
    expect(getActiveTabIndex(visitorTabs, "/stations")).toBe(0);
    expect(getActiveTabIndex(visitorTabs, "/zh-Hant/stations")).toBe(0);
    expect(getActiveTabIndex(visitorTabs, "/station/orchard")).toBe(0);
    expect(getActiveTabIndex(visitorTabs, "/plan")).toBe(1);
    expect(getActiveTabIndex(visitorTabs, "/zh-Hant/plan")).toBe(1);
    expect(getActiveTabIndex(visitorTabs, "/add")).toBe(2);
    expect(getActiveTabIndex(visitorTabs, "/settings")).toBe(3);
    expect(getActiveTabIndex(visitorTabs, "/zh-Hant/settings")).toBe(3);
    expect(getActiveTabIndex(visitorTabs, "/")).toBe(-1); // visitor landing
    expect(getActiveTabIndex(visitorTabs, "/trip")).toBe(-1);
    expect(getActiveTabIndex(visitorTabs, "/me")).toBe(-1);
  });
});

describe("TabBar component rendering", () => {
  it("renders 5 items for owner with appropriate icons and labels", () => {
    const html = renderToStaticMarkup(<TabBar role="owner" />);
    expect(html).toContain('href="/trip"');
    expect(html).toContain('href="/stations"');
    expect(html).toContain('href="/add"');
    expect(html).toContain('href="/plan"');
    expect(html).toContain('href="/me"');
    expect(html).toContain("Trip");
    expect(html).toContain("Stations");
    expect(html).toContain("Log");
    expect(html).toContain("Plan");
    expect(html).toContain("Me");
    expect(html).toContain("fixed bottom-0");
    expect(html).toContain("z-40");
    expect(html).toContain("max-w-5xl");
    expect(html).toContain("bg-panel");
    expect(html).toContain("border-t border-line");
  });

  it("renders 4 items for visitor (Stations, Plan, Log, More)", () => {
    const html = renderToStaticMarkup(<TabBar role={null} />);
    expect(html).not.toContain('href="/trip"');
    expect(html).not.toContain('href="/me"');
    expect(html).toContain('href="/stations"');
    expect(html).toContain('href="/plan"');
    expect(html).toContain('href="/add"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Stations");
    expect(html).toContain("Plan");
    expect(html).toContain("Log");
    expect(html).toContain("More");
  });
});
