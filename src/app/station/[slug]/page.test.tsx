import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

let currentHeaders = new Headers();

vi.mock("next/headers", () => ({
  headers: async () => currentHeaders,
  cookies: async () => ({
    get: () => undefined,
  }),
}));

import StationPage from "./page";
import { I18nProvider } from "@/components/i18n";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";

describe("StationPage (/station/[slug])", () => {
  beforeEach(() => {
    currentHeaders = new Headers();
  });

  it("renders a one-line 13px muted subtitle under station name", async () => {
    const pageEl = await StationPage({
      params: Promise.resolve({ slug: "outram-park" }),
    });

    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <AnalyticsProvider locale="en" userType="visitor" experiments={{}}>
          {pageEl}
        </AnalyticsProvider>
      </I18nProvider>
    );

    // Station name
    expect(html).toContain("Outram Park");
    // 13px muted subtitle
    expect(html).toContain("text-[13px] text-muted");
    expect(html).toContain("Next trains towards each terminal · tap “I boarded” when you get on");
  });

  it("renders the subtitle in Traditional Chinese when in zh-Hant", async () => {
    currentHeaders.set("x-mrt-locale", "zh-Hant");
    const pageEl = await StationPage({
      params: Promise.resolve({ slug: "outram-park" }),
    });

    const html = renderToStaticMarkup(
      <I18nProvider locale="zh-Hant">
        <AnalyticsProvider locale="zh-Hant" userType="visitor" experiments={{}}>
          {pageEl}
        </AnalyticsProvider>
      </I18nProvider>
    );

    expect(html).toContain("text-[13px] text-muted");
    expect(html).toContain("往各終點站的下一班車 · 上車時點擊「我上車了」");
  });

  it("Outram Park page collapses NE line card by default behind tap-to-expand button", async () => {
    const pageEl = await StationPage({
      params: Promise.resolve({ slug: "outram-park" }),
    });

    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <AnalyticsProvider locale="en" userType="visitor" experiments={{}}>
          {pageEl}
        </AnalyticsProvider>
      </I18nProvider>
    );

    // North East Line header row is collapsed by default
    expect(html).toContain("North East Line · tap to expand");
    // "Screen" button label is present
    expect(html).toContain("Screen");
  });
});
