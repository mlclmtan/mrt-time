import { describe, expect, it } from "vitest";
import { affectedLines, parseAlerts, parseCrowd } from "./lta";
import { parseTwoHour } from "./weather";

// Synthetic payloads shaped like LTA DataMall / data.gov.sg responses.
describe("LTA DataMall parsers", () => {
  it("parses train service alerts and skips recovered empty segments", () => {
    const alerts = parseAlerts({
      value: {
        Status: 2,
        AffectedSegments: [
          { Line: "EWL", Direction: "Pasir Ris", Stations: "EW15,EW16,EW17", FreePublicBus: "EW15,EW16,EW17" },
          { Line: "TEL", Direction: "Both", Stations: "" },
        ],
        Message: [{ Content: "Delays between Tanjong Pagar and Tiong Bahru.", CreatedDate: "2026-11-02 08:00:00" }],
      },
    })!;
    expect(alerts.status).toBe(2);
    expect(alerts.segments).toEqual([{ line: "EWL", direction: "Pasir Ris", stations: ["EW15", "EW16", "EW17"] }]);
    expect(affectedLines(alerts)).toEqual(["EWL"]);
    expect(parseAlerts({})).toBeNull();
    expect(affectedLines(parseAlerts({ value: { Status: 1, AffectedSegments: [], Message: [] } }))).toEqual([]);
  });

  it("parses crowd density levels", () => {
    expect(
      parseCrowd({ value: [{ Station: "EW16", CrowdLevel: "h" }, { Station: "EW17", CrowdLevel: "weird" }] }),
    ).toEqual({ EW16: "h", EW17: "NA" });
  });
});

describe("weather", () => {
  it("reads the latest 2-hour forecast per area", () => {
    expect(
      parseTwoHour({
        code: 0,
        data: {
          area_metadata: [],
          items: [{ forecasts: [{ area: "City", forecast: "Thundery Showers" }, { area: "Bukit Merah", forecast: "Cloudy" }] }],
        },
      }),
    ).toEqual({ City: "Thundery Showers", "Bukit Merah": "Cloudy" });
  });
});
