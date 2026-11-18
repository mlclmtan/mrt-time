import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MINUTE, sgtClock, sgtInstant } from "@/lib/time";
import { makeT } from "@/lib/i18n";
import type { Leg, TrainSchedule, TrainSource } from "@/lib/journey/plan";
import { commuteView, type DepartureRow } from "@/lib/journey/commute";
import { predictionSource } from "@/lib/journey/source";
import { CommutePanel, leaveHeader, activeDeparture } from "./commute-panel";

// Synthetic fixtures only (2026-11-03 is a Tuesday).
const at = (clock: string) => sgtInstant("2026-11-03", clock);
const legs: Leg[] = [
  { kind: "walk", min: 9 },
  { kind: "ride", line: "EWL", from: "EW17", to: "EW16", direction: "TO_EAST", rideMin: 3, tip: "Door 3-2" },
  { kind: "transfer", min: 2, at: "outram-park" },
  { kind: "ride", line: "TEL", from: "TE17", to: "TE19", direction: "TO_BAYSHORE", rideMin: 3 },
  { kind: "walk", min: 5 },
];
const every = (start: string, min: number) => Array.from({ length: 60 }, (_, i) => at(start) + i * min * MINUTE);
const ewl: TrainSchedule = { kind: "times", times: every("18:02", 5), headwayMin: 5, confidence: "high", reason: { code: "reading_ago", params: { minutes: 1 } }, anchorAt: at("17:48") };
const tel: TrainSchedule = { kind: "times", times: every("18:03", 6), headwayMin: 6, confidence: "medium", reason: { code: "historical_anchor", params: { clock: "18:03" } } };
const timed: TrainSource = (leg) => (leg.line === "EWL" ? ewl : tel);

describe("CommutePanel", () => {
  it("shows leave-now, a countdown, 6 departures with clocks and the door tip", () => {
    const now = at("18:00");
    const view = commuteView("office_to_home", legs, { state: "idle", fromLeg: 0, startAt: now }, timed, now);
    const html = renderToStaticMarkup(<CommutePanel view={view} now={now} staleAt={null} />);
    expect(html).toContain("Next departures");
    expect(html.match(/<li class="py-2">/g)).toHaveLength(6);
    // 18:00 + walk 9 → first EWL 18:12 → leave by 18:03, i.e. in 3:00: the header says so (not "Leave now").
    expect(html).toMatch(/<h2 id="leave-now"[^>]*>Leave in 3:00<\/h2>/);
    expect(html).not.toContain("Leave now");
    expect(html).toContain("Leave by 18:03");
    expect(html).toContain("18:12");
    expect(html).toContain("From the platform screen 12 min ago");
    expect(html).toContain("Door 3-2");
    expect(html).not.toContain("Clock times shift");
  });

  it("header: 'Leave in m:ss' while leave-by is > 30 s away, 'Leave now' in the last 30 s, then 'missed, next: HH:MM'", () => {
    const now = at("18:00");
    const view = commuteView("office_to_home", legs, { state: "idle", fromLeg: 0, startAt: now }, timed, now);
    const { rows } = view;
    const t = makeT("en");
    expect(sgtClock(rows[0].leaveAt)).toBe("18:03");
    expect(leaveHeader(t, rows, at("18:00"))).toBe("Leave in 3:00");
    // The live-check case: 3:51 before leave-by reads "Leave in 3:51", never "Leave now".
    expect(leaveHeader(t, rows, rows[0].leaveAt - (3 * 60 + 51) * 1000)).toBe("Leave in 3:51");
    expect(leaveHeader(t, rows, rows[0].leaveAt - 31_000)).toBe("Leave in 0:31");
    expect(leaveHeader(t, rows, rows[0].leaveAt - 30_000)).toBe("Leave now");
    expect(leaveHeader(t, rows, rows[0].leaveAt)).toBe("Leave now");
    expect(leaveHeader(t, rows, rows[0].leaveAt + 1000)).toBe(`You've missed this one, next: ${sgtClock(rows[1].leaveAt)}`);
    // Rendered: the header follows the clock.
    const html = renderToStaticMarkup(<CommutePanel view={view} now={rows[0].leaveAt + 5000} staleAt={null} />);
    expect(html).toContain("You&#x27;ve missed this one, next: 18:08");
  });

  it("door tip: icon aligned on the first line, the full text wraps (never cut short)", () => {
    const tip = "Door 3-2 — nearest the escalator up to the Thomson–East Coast Line platform at Outram Park";
    const long: Leg[] = legs.map((l) => (l.kind === "ride" && l.line === "EWL" ? { ...l, tip } : l));
    const now = at("18:00");
    const html = renderToStaticMarkup(<CommutePanel view={commuteView("office_to_home", long, { state: "idle", fromLeg: 0, startAt: now }, timed, now)} now={now} staleAt={null} />);
    const row = /<p class="door-tip ([^"]*)">(.*?)<\/p>/.exec(html);
    expect(row).not.toBeNull();
    expect(row![1]).toContain("items-start");
    expect(row![2]).toMatch(/<svg[^>]*class="[^"]*shrink-0/);
    expect(row![2]).toContain(`Best doors: ${tip}`);
    expect(html).not.toMatch(/door-tip[^"]*(truncate|line-clamp|text-ellipsis)/);
    expect(row![2]).toMatch(/<span class="[^"]*whitespace-normal/);
  });

  it("shows ranges inside the unstable window", () => {
    const now = at("09:40");
    const view = commuteView("home_to_office", legs, { state: "idle", fromLeg: 0, startAt: now }, predictionSource([]), now);
    const html = renderToStaticMarkup(<CommutePanel view={view} now={now} staleAt={null} />);
    expect(html).toContain("Clock times shift at this hour — showing ranges.");
    expect(html).toMatch(/Arrive \d\d:\d\d–\d\d:\d\d/);
    expect(html).toMatch(/Wait 0–\d+ min/);
  });

  describe("activeDeparture (missed train bugfix, problem 5)", () => {
    const fixedRows = [
      { leaveAt: at("12:56"), arriveAt: at("13:22"), best: at("13:19"), worst: at("13:32"), ranged: true, rides: [] },
      { leaveAt: at("13:02"), arriveAt: at("13:28"), best: at("13:25"), worst: at("13:38"), ranged: true, rides: [] },
      { leaveAt: at("13:08"), arriveAt: at("13:34"), best: at("13:31"), worst: at("13:44"), ranged: true, rides: [] },
    ] as unknown as DepartureRow[];

    it("shows the first departure while its leave-by has not passed", () => {
      const active = activeDeparture(fixedRows, null, at("12:55"));
      expect(active?.leaveAt).toBe(at("12:56"));
      expect(active?.arriveAt).toBe(at("13:22"));
    });

    it("at exact leave-by timestamp, rider can still catch the first departure", () => {
      const active = activeDeparture(fixedRows, null, at("12:56"));
      expect(active?.leaveAt).toBe(at("12:56"));
    });

    it("once leave-by has passed (12:56:01), shows the NEXT catchable departure (13:02) and its arrival", () => {
      const afterFirstPassed = at("12:56") + 1000;
      const active = activeDeparture(fixedRows, null, afterFirstPassed);
      expect(active?.leaveAt).toBe(at("13:02"));
      expect(active?.arriveAt).toBe(at("13:28"));
      expect(active?.best).toBe(at("13:25"));
    });

    it("once second leave-by has also passed (13:03), shows the third departure (13:08)", () => {
      const afterSecondPassed = at("13:03");
      const active = activeDeparture(fixedRows, null, afterSecondPassed);
      expect(active?.leaveAt).toBe(at("13:08"));
      expect(active?.arriveAt).toBe(at("13:34"));
    });

    it("when leave-by has passed, rendered CommutePanel displays next catchable train's leave-by and arrival", () => {
      const view = commuteView("office_to_home", legs, { state: "idle", fromLeg: 0, startAt: at("18:00") }, timed, at("18:00"));
      // view.rows[0].leaveAt is 18:03, view.rows[1].leaveAt is 18:08
      const now = view.rows[0].leaveAt + 5000; // 18:03:05
      const html = renderToStaticMarkup(<CommutePanel view={view} now={now} staleAt={null} />);
      // Shows NEXT departure he can still catch:
      expect(html).toContain("Leave by 18:08");
      expect(html).not.toContain("Leave by 18:03");
      // Arrival for 18:08 departure is 18:35 (not 18:29)
      expect(html).toContain("Arrive ~18:35");
    });
  });
});
