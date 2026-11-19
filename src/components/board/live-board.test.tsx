import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveBoard } from "./live-board";
import type { Board } from "@/lib/server/board";
import { sgtInstant } from "@/lib/time";

describe("LiveBoard (problem 2 & 7: compact station page & glanceable sizes)", () => {
  const now = sgtInstant("2026-11-10", "10:20");
  const board: Board = {
    station: "outram-park",
    now,
    platforms: [
      {
        code: "EW16",
        line: "EWL",
        lineName: { en: "East–West Line", "zh-Hant": "東西線" },
        color: "#009645",
        inService: true,
        directions: [
          {
            key: "TO_EAST",
            label: { en: "towards Pasir Ris", "zh-Hant": "往巴西立" },
            board: { en: "Pasir Ris", "zh-Hant": "巴西立" },
            terminal: "EW1",
            prediction: {
              kind: "times",
              headwayMin: 5,
              waitMin: { min: 0, max: 5 },
              band: "weekday_offpeak",
              unstable: false,
              confidence: "high",
              basis: "historical",
              arrivals: [
                { at: now + 2 * 60_000, inMin: 2, errMin: 1 },
                { at: now + 7 * 60_000, inMin: 7, errMin: 1 },
                { at: now + 12 * 60_000, inMin: 12, errMin: 1 },
              ],
              reason: { code: "historical_anchor", params: { clock: "10:22", date: "2026-11-03" } },
            },
            seenToday: [],
          },
        ],
      },
    ],
  };

  it("renders a compact direction block with destination and next three times on one row", () => {
    const html = renderToStaticMarkup(
      <LiveBoard slug="outram-park" initial={{ board, alerts: null, crowd: null }} />
    );
    // Destination is shown
    expect(html).toContain("Pasir Ris");
    // Next 3 times are rendered
    expect(html).toContain("10:22");
    expect(html).toContain("10:27");
    expect(html).toContain("10:32");
    // Countdown "in 2 min" is >= 17px
    expect(html).toContain("text-[17px]");
    // "then" times are >= 15px
    expect(html).toContain("text-[15px]");
  });

  it("renders I boarded / Got off buttons directly under the times row with no time chips", () => {
    const html = renderToStaticMarkup(
      <LiveBoard slug="outram-park" initial={{ board, alerts: null, crowd: null }} />
    );
    expect(html).toContain("I boarded");
    expect(html).toContain("Got off");
    // No time chips before tap (problem 6)
    expect(html).not.toContain('aria-label="Now');
    expect(html).not.toContain("Other time");
  });

  it("collapses the 'Screen says…' entry behind a >= 44px button initially", () => {
    const html = renderToStaticMarkup(
      <LiveBoard slug="outram-park" initial={{ board, alerts: null, crowd: null }} />
    );
    // Button is present with >= 44px min height
    expect(html).toContain("Screen says…");
    expect(html).toContain("min-h-[44px]");
    // QuickEntry slots are collapsed initially
    expect(html).not.toContain('aria-label="First train minutes"');
  });

  it("does not show disabled Save button on direction cards before anything is typed", () => {
    const html = renderToStaticMarkup(
      <LiveBoard slug="outram-park" initial={{ board, alerts: null, crowd: null }} />
    );
    expect(html).not.toContain(">Save</button>");
  });

  it("renders one row with [I boarded] [Got off] [Screen says…] side-by-side with no prompt sentence", () => {
    const html = renderToStaticMarkup(
      <LiveBoard slug="outram-park" initial={{ board, alerts: null, crowd: null }} />
    );
    // 3-column grid for buttons
    expect(html).toContain("grid-cols-3");
    // All 3 buttons present
    expect(html).toContain("I boarded");
    expect(html).toContain("Got off");
    expect(html).toContain("Screen says…");
    // Buttons are at least 44px tall
    expect(html).toContain("min-h-[44px]");
    // No visible prompt sentence
    expect(html).not.toContain("On a train to");
    expect(html).not.toContain("Tap when you get on or off");
    // Estimate chip present
    expect(html).toContain("Estimate");
    expect(html).toContain("chip");
  });

  it("renders 'in N min' as MAIN time (>= 32px, bold, LED) and clock time as secondary (>= 15px)", () => {
    const html = renderToStaticMarkup(
      <LiveBoard slug="outram-park" initial={{ board, alerts: null, crowd: null }} />
    );
    // Main countdown LED style >= 32px
    expect(html).toMatch(/text-\[32px\][^"]*font-bold[^"]*leading-none/);
    expect(html).toContain("2 min");
    // Clock time secondary >= 15px
    expect(html).toMatch(/text-\[15px\][^"]*tabular/);
    expect(html).toContain("10:22");
    // Next train "in 7 min · ≈10:27" >= 17px
    expect(html).toMatch(/text-\[17px\][^"]*font-semibold[^"]*text-muted/);
    expect(html).toContain("in 7 min · ≈10:27");
  });

  it("collapses NE (third) line card at Outram Park by default behind 'tap to expand' button", () => {
    const outramBoard: Board = {
      ...board,
      platforms: [
        ...board.platforms,
        {
          code: "NE3",
          line: "NEL" as never,
          lineName: { en: "North East Line", "zh-Hant": "東北線" },
          color: "#9900aa",
          inService: true,
          directions: [
            {
              key: "TO_NORTH",
              label: { en: "towards Punggol", "zh-Hant": "往榜鵝" },
              board: { en: "Punggol", "zh-Hant": "榜鵝" },
              terminal: "NE17",
              prediction: board.platforms[0].directions[0].prediction,
              seenToday: [],
            },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      <LiveBoard slug="outram-park" initial={{ board: outramBoard, alerts: null, crowd: null }} />
    );

    // NE platform card is collapsed behind header row
    expect(html).toContain("North East Line · tap to expand");
    // Directions under NE platform are not rendered when collapsed
    expect(html).not.toContain("Punggol");
  });
});
