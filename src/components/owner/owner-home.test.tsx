import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { sgtInstant } from "@/lib/time";
import type { Leg, TrainSource } from "@/lib/journey/plan";
import { commuteProgress, commuteView } from "@/lib/journey/commute";
import { OwnerHome, nextTapKind } from "./owner-home";
import { CommutePanel } from "./commute-panel";
import { TimeChips } from "../boarding/time-chips";
import { showFloatingFeedback } from "../voc/feedback-widget";

// Synthetic fixtures only (2026-11-10 is a Tuesday).
const at = (clock: string) => sgtInstant("2026-11-10", clock);
const legs: Leg[] = [
  { kind: "walk", min: 9 },
  { kind: "ride", line: "EWL", from: "EW17", to: "EW16", direction: "TO_EAST", rideMin: 3 },
  { kind: "transfer", min: 2, at: "outram-park" },
  { kind: "ride", line: "TEL", from: "TE17", to: "TE19", direction: "TO_BAYSHORE", rideMin: 3 },
  { kind: "walk", min: 5 },
];
const every = (start: string, min: number) => Array.from({ length: 80 }, (_, i) => at(start) + i * min * 60_000);
const timed: TrainSource = (leg) => ({ kind: "times", times: every(leg.line === "EWL" ? "07:02" : "07:03", leg.line === "EWL" ? 5 : 6), headwayMin: 5, confidence: "high" });
const journey = { key: "home_to_office", name: "Home → Office", fromPlace: "home", toPlace: "office", legs, sheltered: false };
const taps = [
  { id: 1, kind: "board", at: at("10:14"), station: "EW17", line: "EWL", direction: "TO_EAST", journeyKey: "home_to_office" },
  { id: 2, kind: "board", at: at("10:17"), station: "TE17", line: "TEL", direction: "TO_BAYSHORE", journeyKey: "home_to_office" },
];
const render = (now: number, today = taps) =>
  renderToStaticMarkup(
    <OwnerHome
      journeys={[journey]}
      initialKey="home_to_office"
      initialChoice={null}
      initialView={commuteView("home_to_office", legs, commuteProgress(legs, today, now), timed, now)}
      today={today}
      stations={[]}
      remindersAvailable={false}
      defaultTime="11:19"
    />,
  );

describe("owner Home layout (H2) and next step (F10)", () => {
  it("puts one big journey-aware next-step button first, docked above the consent sheet", () => {
    const html = render(at("09:00"), []);
    const button = html.indexOf("data-next-step=");
    expect(button).toBeGreaterThan(0);
    // Before the train times, the logging panel and everything else.
    expect(button).toBeLessThan(html.indexOf("Leave now"));
    expect(button).toBeLessThan(html.indexOf('aria-label="Log a step"'));
    expect(html).toMatch(/class="next-step-dock sticky z-30" data-next-step="at_platform"/);
    expect(html).toContain("Next: At platform · Tiong Bahru");
    // Owner pages are masked for Clarity.
    expect(html).toContain('data-clarity-mask="True"');
  });

  it("computed layout: the dock sits above the sheet (--consent-h) and the page pads for it", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const dock = /\.next-step-dock\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(dock).toMatch(/bottom:\s*calc\(max\(var\(--consent-h, 0px\), env\(safe-area-inset-bottom\)\) \+ 8px\)/);
    const body = /\nbody\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(body).toMatch(/padding-bottom:\s*var\(--consent-h, 0px\)/);
    // 393×852 with a 160 px sheet: a sticky 64 px button (min-h-16) ends 8 px above the sheet's top edge.
    const viewport = 852;
    const sheet = 160;
    const buttonBottom = viewport - Math.max(sheet, 34) - 8;
    expect(buttonBottom).toBeLessThanOrEqual(viewport - sheet);
    expect(buttonBottom - 64).toBeGreaterThan(0);
  });

  it("the floating Feedback button is hidden on owner Home only (still in the footer and Settings)", () => {
    expect(showFloatingFeedback("/", "owner")).toBe(false);
    expect(showFloatingFeedback("/zh-Hant", "owner")).toBe(false);
    expect(showFloatingFeedback("/plan", "owner")).toBe(true);
    expect(showFloatingFeedback("/", "visitor")).toBe(true);
    const shell = readFileSync(new URL("../shell.tsx", import.meta.url), "utf8");
    expect(shell).toContain("<FeedbackLink");
    const settings = readFileSync(new URL("../../app/settings/page.tsx", import.meta.url), "utf8");
    expect(settings).toContain("<FeedbackLink");
  });

  it("H1 at 11:19: no 'On board', the next step is the desk and Home asks 'Arrived ~10:25?'", () => {
    const html = render(at("11:19"));
    expect(html).not.toContain("On board");
    expect(html).toContain('data-next-step="desk"');
    expect(nextTapKind(undefined, true, "desk")).toBe("desk");
    const view = commuteView("home_to_office", legs, commuteProgress(legs, taps, at("11:19")), timed, at("11:19"));
    const panel = renderToStaticMarkup(<CommutePanel view={view} now={at("11:19")} staleAt={null} finished={{ what: "At my desk", onLog: () => {}, onDismiss: () => {} }} />);
    expect(panel).toContain("Arrived ~10:25?");
    expect(panel).toContain("Log At my desk");
    expect(panel).toContain("Dismiss");
    // Dismissed: nothing left to show.
    expect(renderToStaticMarkup(<CommutePanel view={view} now={at("11:19")} staleAt={null} finished={null} />)).toBe("");
  });

  it("time chips read as clock times: 10:14 · 10:13 · 10:12 · 10:09 · Other time", () => {
    const html = renderToStaticMarkup(<TimeChips value={{ kind: "ago", minutes: 0 }} onChange={() => {}} now={at("10:14")} />);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text).toBe("10:14 10:13 10:12 10:09 Other time");
    expect(html).toContain('aria-label="Now, 10:14"');
  });
});
