import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TripScreen } from "./trip-screen";
import { sgtInstant } from "@/lib/time";
import type { Leg, TrainSource } from "@/lib/journey/plan";
import { commuteView, resolveTrip } from "@/lib/journey/commute";
import type { OwnerJourney } from "@/lib/server/journeys";
import type { Logged } from "../owner/owner-home";

const at = (clock: string) => sgtInstant("2026-11-10", clock);

const sampleLegs: Leg[] = [
  { kind: "walk", min: 9, label: "Home → EW17 platform" },
  { kind: "ride", line: "EWL", from: "EW17", to: "EW16", direction: "TO_EAST", rideMin: 3, tip: "Door 3" },
  { kind: "transfer", min: 4, at: "outram-park" },
  { kind: "ride", line: "TEL", from: "TE17", to: "TE19", direction: "TO_BAYSHORE", rideMin: 4, tip: "Door 1" },
  { kind: "walk", min: 5, label: "TE19 → Office" },
];

const every = (start: string, min: number) =>
  Array.from({ length: 80 }, (_, i) => at(start) + i * min * 60_000);

const timed: TrainSource = (leg) => ({
  kind: "times",
  times: every(leg.line === "EWL" ? "07:02" : "07:03", leg.line === "EWL" ? 5 : 6),
  headwayMin: 5,
  confidence: "high",
});

const sampleJourney: OwnerJourney = {
  id: 1,
  key: "home_to_office",
  name: "Home → Office",
  fromPlace: "home",
  toPlace: "office",
  legs: sampleLegs,
  sheltered: false,
};

const renderTrip = (now: number, today: Logged[] = [], dismissedAt: number | null = null) => {
  const trip = resolveTrip(sampleJourney, today, now, { dismissedAt });
  const view = commuteView(sampleJourney.key, sampleLegs, trip.progress, timed, now);

  return renderToStaticMarkup(
    <TripScreen
      journeys={[sampleJourney]}
      initialKey="home_to_office"
      initialChoice={null}
      initialView={view}
      initialDismissedAt={dismissedAt}
      today={today}
    />,
  );
};

describe("TripScreen (/trip)", () => {
  it("renders 44px top progress rail with all journey stations", () => {
    const html = renderTrip(at("08:30"), []);
    // 44px height progress rail
    expect(html).toContain("h-11");
    // Station names
    expect(html).toContain("Tiong Bahru");
    expect(html).toContain("Outram Park");
    expect(html).toContain("Shenton Way");
    // Journey selector
    expect(html).toContain("Home → Office");
    // Line chips with station codes
    expect(html).toContain("EW17");
    expect(html).toContain("TE17");
    expect(html).toContain("TE19");
  });

  it("renders large LED styles and required font sizes on the Now card", () => {
    const html = renderTrip(at("08:30"), []);
    // Large LED clock (≥ 48px)
    expect(html).toContain("text-5xl font-black tabular led text-led");
    // Countdown (≥ 20px)
    expect(html).toContain("text-xl font-bold tabular");
    // Next 2 times (≥ 24px)
    expect(html).toContain("text-2xl font-bold tabular led");
    // Door tip (≥ 17px)
    expect(html).toContain("text-[17px] font-medium leading-snug text-led");
    expect(html).toContain("Door 3");
  });

  it("renders full-width primary button ≥ 72px tall and secondary row ≥ 48px tall", () => {
    const html = renderTrip(at("08:30"), []);
    // Primary button ≥ 72px
    expect(html).toContain("h-[72px] min-h-[72px]");
    expect(html).toContain("I boarded");

    // Secondary row ≥ 48px
    expect(html).toContain("h-12 min-h-[48px]");
    expect(html).toContain("Screen says…");
    expect(html).toContain("I&#x27;m at the platform"); // escaped apostrophe
  });

  it("shows arrival time at next stop and transfer platform's trains when on board", () => {
    // Passenger tapped "I boarded" at EW17 at 08:30
    const boardedTaps = [
      {
        id: 1,
        kind: "board",
        at: at("08:30"),
        station: "EW17",
        line: "EWL",
        direction: "TO_EAST",
        journeyKey: "home_to_office",
      },
    ];

    const html = renderTrip(at("08:31"), boardedTaps);
    // On board indication
    expect(html).toContain("On board towards");
    // Arrival at next stop (Outram Park)
    expect(html).toContain("Arriving at Outram Park");
    // Transfer platform info (TE17 towards Bayshore)
    expect(html).toContain("TE17");
    expect(html).toContain("min walk to TE17");
    // Shows catch hint for transfer train
    expect(html).toContain("You&#x27;ll catch");
    // Primary action follows state: "Got off"
    expect(html).toContain("Got off");
  });

  it("shows got off destination and desk action after transfer ride", () => {
    const completedLeg1 = [
      { id: 1, kind: "board", at: at("08:30"), station: "EW17", line: "EWL", direction: "TO_EAST", journeyKey: "home_to_office" },
      { id: 2, kind: "alight", at: at("08:33"), station: "EW16", line: "EWL", direction: "TO_EAST", journeyKey: "home_to_office" },
    ];

    const html = renderTrip(at("08:35"), completedLeg1);
    // After getting off leg 1, primary button is "I boarded" for transfer leg
    expect(html).toContain("I boarded");
    expect(html).toContain("TE17");
  });

  it("renders empty state with plan link when no journeys exist", () => {
    const html = renderToStaticMarkup(
      <TripScreen
        journeys={[]}
        initialChoice={null}
        initialView={null}
        today={[]}
      />,
    );
    expect(html).toContain("No saved journeys");
    expect(html).toContain("Plan a trip");
    expect(html).toContain("/plan");
  });

  it("renders complete state when trip has finished", () => {
    const completedTaps = [
      { id: 1, kind: "board", at: at("08:30"), station: "EW17", line: "EWL", direction: "TO_EAST", journeyKey: "home_to_office" },
      { id: 2, kind: "alight", at: at("08:33"), station: "EW16", line: "EWL", direction: "TO_EAST", journeyKey: "home_to_office" },
      { id: 3, kind: "board", at: at("08:37"), station: "TE17", line: "TEL", direction: "TO_BAYSHORE", journeyKey: "home_to_office" },
      { id: 4, kind: "alight", at: at("08:41"), station: "TE19", line: "TEL", direction: "TO_BAYSHORE", journeyKey: "home_to_office" },
    ];

    // At 09:05 (> expected arrival 08:46 + 15 min), progress state is finished
    const html = renderTrip(at("09:05"), completedTaps);
    expect(html).toContain("Trip complete");
    expect(html).toContain("Done");
  });
});
