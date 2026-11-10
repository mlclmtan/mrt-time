import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { sgtInstant } from "@/lib/time";
import type { Leg, TrainSource } from "@/lib/journey/plan";
import { commuteView, resolveTrip } from "@/lib/journey/commute";
import { OwnerHome } from "./owner-home";
import { CommutePanel } from "./commute-panel";
import { TimeChips } from "../boarding/time-chips";

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
/** Visible text of the docked next-step buttons. */
const dockText = (html: string) => {
  const start = html.indexOf('<div class="next-step-dock');
  const end = html.indexOf("</div>", start);
  return html
    .slice(start, end)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};
/** Like the server page: the same resolver picks the progress behind the first view. */
const render = (now: number, today: typeof taps = taps, dismissedAt: number | null = null) =>
  renderToStaticMarkup(
    <OwnerHome
      journeys={[journey]}
      initialKey="home_to_office"
      initialChoice={null}
      initialView={commuteView("home_to_office", legs, resolveTrip(journey, today, now, { dismissedAt }).progress, timed, now)}
      initialDismissedAt={dismissedAt}
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
    expect(button).toBeLessThan(html.indexOf('id="leave-now"'));
    expect(button).toBeLessThan(html.indexOf('aria-label="Log a step"'));
    // A new trip starts at the journey's first step: the home door.
    expect(html).toMatch(/class="next-step-dock sticky z-30[^"]*" data-next-step="door"/);
    expect(dockText(html)).toBe("Next: Home door");
    // Left the door: the first platform.
    const door = [{ id: 3, kind: "door", at: at("08:55"), station: null, line: null, direction: null, journeyKey: "home_to_office" }];
    expect(dockText(render(at("09:00"), door as never))).toBe("Next: At platform · Tiong Bahru");
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

  it("no floating Feedback button anywhere (v2.1.1); Feedback stays in the footer and Settings", () => {
    const widget = readFileSync(new URL("../voc/feedback-widget.tsx", import.meta.url), "utf8");
    expect(widget).not.toMatch(/className="[^"]*\bfixed right-/);
    expect(widget).not.toContain("float-bottom");
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    expect(css).not.toContain(".float-bottom");
    const shell = readFileSync(new URL("../shell.tsx", import.meta.url), "utf8");
    expect(shell).toContain("<FeedbackLink");
    const settings = readFileSync(new URL("../../app/settings/page.tsx", import.meta.url), "utf8");
    expect(settings).toContain("<FeedbackLink");
    // The dialog the links open is still mounted site-wide.
    const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain("<FeedbackWidget");
  });

  for (const clock of ["11:19", "12:10"]) {
    it(`H1 at ${clock} (taps 10:14 / 10:17): button and card both ask 'Arrived ~10:25?'`, () => {
      const html = render(at(clock));
      expect(html).not.toContain("On board");
      expect(html).not.toContain("Got off · Shenton Way");
      // The big button: same finished-trip state as the card.
      expect(html).toContain('data-next-step="desk" data-trip-state="finished"');
      expect(dockText(html)).toBe("Arrived ~10:25? · Log At my desk Dismiss");
      // The card: the prompt above a fresh pre-departure plan for the journey.
      const card = html.slice(html.indexOf('data-commute-state="finished"'));
      expect(card).toContain("Arrived ~10:25?");
      expect(card).toContain("Log At my desk");
      expect(card).toContain("Dismiss");
      expect(card).toMatch(/<h2 id="leave-now"[^>]*>(Leave in \d+:\d\d|Leave now)<\/h2>/);
      expect(card).toMatch(/Leave by \d\d:\d\d/);
    });
  }

  it("after Dismiss at 12:10: the next step is the journey's first (Home door), no prompt", () => {
    const html = render(at("12:10"), taps, at("10:17"));
    expect(html).toContain('data-next-step="door" data-trip-state="idle"');
    expect(dockText(html)).toBe("Next: Home door");
    expect(html).not.toContain("Arrived ~10:25?");
    expect(html).toMatch(/<h2 id="leave-now"[^>]*>Leave in \d+:\d\d<\/h2>/);
  });

  it("the card's prompt follows the resolver, and dismissing keeps the fresh plan", () => {
    const now = at("12:10");
    const view = commuteView("home_to_office", legs, resolveTrip(journey, taps, now).progress, timed, now);
    const prompt = { arrivedAt: at("10:25"), what: "At my desk", onLog: () => {}, onDismiss: () => {} };
    expect(renderToStaticMarkup(<CommutePanel view={view} now={now} staleAt={null} finished={prompt} />)).toContain("Arrived ~10:25?");
    const dismissed = renderToStaticMarkup(<CommutePanel view={view} now={now} staleAt={null} finished={null} />);
    expect(dismissed).not.toContain("Arrived");
    expect(dismissed).toContain('id="leave-now"');
  });

  it("time chips read as clock times: 10:14 · 10:13 · 10:12 · 10:09 · Other time", () => {
    const html = renderToStaticMarkup(<TimeChips value={{ kind: "ago", minutes: 0 }} onChange={() => {}} now={at("10:14")} />);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text).toBe("10:14 10:13 10:12 10:09 Other time");
    expect(html).toContain('aria-label="Now, 10:14"');
  });
});
