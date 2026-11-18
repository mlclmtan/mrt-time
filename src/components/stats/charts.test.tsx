import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart, TrendChart } from "./charts";

describe("Stats charts (problem 11)", () => {
  const points = [
    { label: "Mon", values: [25, 30] },
    { label: "Tue", values: [27, 28] },
    { label: "Wed", values: [26, 32] },
  ];
  const series = [
    { label: "To work", color: "#009645" },
    { label: "To home", color: "#9D5B25" },
  ];

  it("renders TrendChart with axis labels >= 24 in SVG (>= 12px rendered on 330px screens)", () => {
    const html = renderToStaticMarkup(
      <TrendChart points={points} series={series} label="Test trend" emptyText="No data" unit="min" />
    );
    // In SVG, labels should be fontSize="24" so they render >= 12px at viewBox scale 600 -> 330px
    const fontSizes = [...html.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(fontSizes.length).toBeGreaterThan(0);
    for (const size of fontSizes) {
      expect(size).toBeGreaterThanOrEqual(24);
      // Account for SVG scale on a 330px container: 24 * (330 / 600) = 13.2px >= 12px
      expect(size * (330 / 600)).toBeGreaterThanOrEqual(12);
    }
    // Unit "min" was moved into card title and does not overlap the top tick in the SVG grid
    expect(html).not.toMatch(/<text[^>]*y="10"[^>]*>min<\/text>/);
    expect(html).not.toMatch(/<text[^>]*>min<\/text>/);
  });

  it("renders BarChart with axis labels >= 24 in SVG and no overlapping unit text in the grid", () => {
    const html = renderToStaticMarkup(
      <BarChart points={points} series={series} label="Test bar" emptyText="No data" unit="min" />
    );
    const fontSizes = [...html.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(fontSizes.length).toBeGreaterThan(0);
    for (const size of fontSizes) {
      expect(size).toBeGreaterThanOrEqual(24);
      expect(size * (330 / 600)).toBeGreaterThanOrEqual(12);
    }
    expect(html).not.toMatch(/<text[^>]*>min<\/text>/);
  });
});
