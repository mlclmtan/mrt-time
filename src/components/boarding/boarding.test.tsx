import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BoardingButtons } from "./boarding-buttons";
import { TripTimeline } from "../owner/trip-timeline";
import { AddReading } from "../add-reading";
import { buildSightingPost, minutesBack, postSighting, resolveTime } from "@/lib/sightings/client";
import { MINUTE, sgtClock, sgtInstant } from "@/lib/time";

const JARGON = /headway|anchor|observation|sighting|propagat|\bkind\b|source|status|TO_EAST|TO_WEST/i;
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("I boarded / Got off", () => {
  it("shows the two big buttons and the time chips in plain words", () => {
    const html = renderToStaticMarkup(<BoardingButtons station="EW17" line="EWL" direction="TO_EAST" destination="Pasir Ris" />);
    const text = visibleText(html);
    for (const s of ["I boarded", "Got off", "Now", "−1 min", "−2 min", "−5 min", "Pick time", "Pasir Ris"]) expect(text).toContain(s);
    expect(text).not.toMatch(JARGON);
  });

  it("appears on /add once a direction is chosen", () => {
    const html = renderToStaticMarkup(<AddReading defaultStation="EW17" defaultDirection="TO_EAST" />);
    expect(html).toContain("I boarded");
    expect(html).toContain("Got off");
    expect(visibleText(html)).not.toMatch(/headway|anchor|observation|TO_EAST/i);
  });

  it("the timeline lists taps with minutes between them, in plain words", () => {
    const at = (c: string) => sgtInstant("2026-11-10", c);
    const events = [
      { id: 1, kind: "board", at: at("10:14"), station: "EW17", line: "EWL", direction: "TO_EAST" },
      { id: 2, kind: "alight", at: at("10:17"), station: "EW16", line: "EWL", direction: "TO_EAST" },
      { id: 3, kind: "board", at: at("10:17"), station: "TE17", line: "TEL", direction: "TO_BAYSHORE" },
    ];
    const text = visibleText(renderToStaticMarkup(<TripTimeline events={events} onChanged={() => {}} />));
    for (const s of ["10:14", "Tiong Bahru", "Outram Park", "Boarded", "Got off", "on the train 3 min", "changed trains in 0 min", "Add a step I missed"]) expect(text).toContain(s);
    expect(text).not.toMatch(JARGON);
  });
});

describe("time chips", () => {
  const now = sgtInstant("2026-11-10", "10:20");
  it("Now · −1 · −2 · −5 min", () => {
    expect(resolveTime({ kind: "ago", minutes: 0 }, now)).toBe(now);
    expect(resolveTime({ kind: "ago", minutes: 5 }, now)).toBe(now - 5 * MINUTE);
    expect(minutesBack(now - 2 * MINUTE, now)).toBe(2);
  });
  it("a picked time is today, or yesterday when later than now; never more than 12 h back", () => {
    expect(sgtClock(resolveTime({ kind: "pick", clock: "10:14" }, now))).toBe("10:14");
    const lateNight = sgtInstant("2026-11-10", "00:30");
    expect(resolveTime({ kind: "pick", clock: "23:50" }, lateNight)).toBe(sgtInstant("2026-11-09", "23:50"));
    expect(resolveTime({ kind: "pick", clock: "21:00" }, now)).toBe(now - 12 * 60 * MINUTE);
  });
  it("posts exactly { station, direction, kind, at }", async () => {
    const body = buildSightingPost({ station: "EW17", direction: "TO_EAST", kind: "boarded", at: now });
    expect(Object.keys(body).sort()).toEqual(["at", "direction", "kind", "station"]);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, status: "approved", id: 7, clientId: null }), { status: 201 }));
    expect(await postSighting(body, { fetch, deviceId: "device-1234" })).toEqual({ kind: "approved", id: 7, clientId: null });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["x-device-id"]).toBe("device-1234");
    const limited = vi.fn(async () => new Response("{}", { status: 429 }));
    expect(await postSighting(body, { fetch: limited })).toEqual({ kind: "limit" });
  });
});
