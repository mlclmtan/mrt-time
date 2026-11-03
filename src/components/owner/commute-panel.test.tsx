import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MINUTE, sgtInstant } from "@/lib/time";
import type { Leg, TrainSchedule, TrainSource } from "@/lib/journey/plan";
import { commuteView } from "@/lib/journey/commute";
import { predictionSource } from "@/lib/journey/source";
import { CommutePanel } from "./commute-panel";

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
    expect(html).toContain("Leave now →");
    expect(html).toContain("Next departures");
    expect(html.match(/<li class="py-2">/g)).toHaveLength(6);
    // 18:00 + walk 9 → first EWL 18:12 → leave by 18:03, i.e. in 3:00.
    expect(html).toContain("Leave in 3:00");
    expect(html).toContain("Leave by 18:03");
    expect(html).toContain("18:12");
    expect(html).toContain("From a board reading 12 min ago");
    expect(html).toContain("Door 3-2");
    expect(html).not.toContain("Clock times shift");
  });

  it("shows ranges inside the unstable window", () => {
    const now = at("09:40");
    const view = commuteView("home_to_office", legs, { state: "idle", fromLeg: 0, startAt: now }, predictionSource([]), now);
    const html = renderToStaticMarkup(<CommutePanel view={view} now={now} staleAt={null} />);
    expect(html).toContain("Clock times shift at this hour — showing ranges.");
    expect(html).toMatch(/Arrive \d\d:\d\d–\d\d:\d\d/);
    expect(html).toMatch(/Wait 0–\d+ min/);
  });
});
