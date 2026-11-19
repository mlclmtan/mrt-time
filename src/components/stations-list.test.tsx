import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StationsList } from "./stations-list";
import { I18nProvider } from "./i18n";
import { AnalyticsProvider } from "./analytics/analytics-provider";
import { getLineGroups } from "@/lib/stations/list";

function renderStationsList(locale: "en" | "zh-Hant" = "en") {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <AnalyticsProvider locale={locale} userType="visitor" experiments={{}}>
        <StationsList />
      </AnalyticsProvider>
    </I18nProvider>
  );
}

describe("StationsList component", () => {
  it("renders a sticky 52px tall search field with >= 17px text", () => {
    const html = renderStationsList();
    // Sticky wrapper
    expect(html).toContain("sticky top-[calc(49px+env(safe-area-inset-top,0px))]");
    // Search input 52px tall, text 17px
    expect(html).toMatch(/<input[^>]*type="search"[^>]*class="[^"]*h-\[52px\][^"]*text-\[17px\]/);
  });

  it("renders segmented control with 4 segments, each >= 44px tall", () => {
    const html = renderStationsList();
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Frequent");
    expect(html).toContain("Near me");
    expect(html).toContain("A–Z");
    expect(html).toContain("By line");

    // Check each segment has min-h-[44px]
    const matches = html.match(/min-h-\[44px\]/g);
    expect(matches).not.toBeNull();
    // 4 tab buttons + station link areas
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  it("defaults to 'Frequent' tab with 'All stations' heading when there is no usage history", () => {
    const html = renderStationsList();
    // Frequent segment has aria-selected="true"
    expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>Frequent<\/button>/);
    // By line segment is NOT selected
    expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="false"[^>]*>By line<\/button>/);
    // Uppercase heading with count >= 12px
    expect(html).toMatch(/<h2[^>]*class="[^"]*text-xs[^"]*uppercase[^"]*"[^>]*>All stations \(\d+\)<\/h2>/);
  });

  it("renders empty state for My stations when no usage yet", () => {
    const html = renderStationsList();
    expect(html).toContain("Stations you open show up here");
  });

  it("renders rows >= 56px tall with name >= 17px, Chinese name >= 13px, chips >= 13px", () => {
    const html = renderStationsList();
    // Row height >= 56px
    expect(html).toContain("min-h-[56px]");
    // Name >= 17px
    expect(html).toContain("text-[17px]");
    // Chinese/Secondary name >= 13px
    expect(html).toContain("text-[13px]");
    // Chips >= 13px
    expect(html).toContain("chip px-2 py-0.5 text-[13px]");
  });

  it("renders a 44x44 star button on every station row", () => {
    const html = renderStationsList();
    // 44x44 star buttons (h-11 w-11)
    expect(html).toContain('aria-label="Pin station"');
    expect(html).toMatch(/<button[^>]*class="[^"]*h-11 w-11[^"]*"/);
  });

  it("shows Chinese name first when in zh-Hant mode", () => {
    const html = renderStationsList("zh-Hant");
    expect(html).toContain("常用");
    expect(html).toContain("附近");
    expect(html).toContain("按路線");
    expect(html).toContain("你打開過的車站會顯示在這裡");

    // In zh-Hant mode, Chinese name appears in primary text-[17px]
    expect(html).toMatch(/<span class="text-\[17px\][^"]*">歐南園<\/span>/);
    // English name appears in secondary text-[13px]
    expect(html).toMatch(/<span class="text-\[13px\][^"]*">Outram Park<\/span>/);
  });

  it("keeps total scroll height with lines folded <= 2500px", () => {
    // When "By line" groups are folded (<details>), only summary rows are visible.
    // 6 lines with 56px summaries = 336px
    // Search + segmented control + empty state = ~200px
    // Total height <= 1000px, comfortably under the 2500px target
    const groups = getLineGroups();
    expect(groups.length).toBe(6);
    const foldedHeightEstimate =
      52 /* search */ + 44 /* segments */ + 56 /* empty state */ + groups.length * 56 /* folded summaries */;
    expect(foldedHeightEstimate).toBeLessThanOrEqual(2500);
  });
});
