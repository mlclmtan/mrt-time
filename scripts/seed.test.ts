import { describe, expect, it } from "vitest";
import { buildJourneys } from "./seed";

// Synthetic profile only (the real seed lives in private/, never in tests).
const seed = {
  profile: {
    owner_email: "owner@example.com",
    home: { label: "Home" },
    office: { label: "Office" },
    legs_min: { door_to_tapin: 7, tapin_to_platform: 2, ewl_ew17_ew16: 3, transfer_ew16_te17_typ: 2, tel_te17_te19: 3, te19_alight_to_desk: 5 },
    best_doors: [{ line: "EWL", from_: "EW17", to: "EW16", direction: "TO_EAST", door: "3-2", why: "nearest the TEL transfer" }],
  },
  observations: [],
  trips: [],
};

describe("seed journeys", () => {
  it("builds the three owner journeys from leg minutes with door tips", () => {
    const [toOffice, toHome, viaTp] = buildJourneys(seed);
    expect(toOffice.key).toBe("home_to_office");
    expect(toOffice.legs.map((l) => l.kind)).toEqual(["walk", "ride", "transfer", "ride", "walk"]);
    expect(toOffice.legs[0]).toMatchObject({ kind: "walk", min: 9 });
    expect(toOffice.legs[1]).toMatchObject({ from: "EW17", to: "EW16", direction: "TO_EAST", tip: "Door 3-2 — nearest the TEL transfer" });
    expect(toHome.legs[1]).toMatchObject({ from: "TE19", to: "TE17", direction: "TO_NORTH" });
    expect(viaTp.legs[1]).toMatchObject({ from: "EW15", to: "EW17", direction: "TO_WEST" });
  });
});
