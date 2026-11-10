import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LINES, PLATFORMS } from "../network";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import { predict, type Observation } from "./index";
import { directionView, gridArrivals, withLocalReading } from "./board-view";
import { buildReadingPost, fillNextSlot, clearSlot, emptySlots, localObservation, postReading, clampSeenAt } from "../readings/entry";
import { DirectionTimes } from "@/components/board/direction-times";

// Synthetic fixtures only. 2026-11-03 is a Tuesday, 2026-11-07 a Saturday.
const at = (date: string, clock: string) => sgtInstant(date, clock);
const TUE = "2026-11-03";

function everyDirection() {
  return Object.values(PLATFORMS).flatMap((p) =>
    Object.values(LINES[p.line].directions)
      .filter((d) => d.terminal !== p.code)
      .map((d) => ({ station: p.code, line: p.line, direction: d.key })),
  );
}

describe("station board view-model", () => {
  it("with no reading today, every direction shows at least one ≈ clock time — never an interval only", () => {
    const times = [at(TUE, "07:40"), at(TUE, "09:40"), at(TUE, "13:05"), at(TUE, "18:10"), at("2026-11-07", "11:00"), at(TUE, "23:50")];
    for (const now of times)
      for (const d of everyDirection()) {
        const p = predict({ ...d, now, observations: [] });
        const view = directionView(p, now, d.line);
        expect(view.state).toBe("estimate");
        if (view.state === "closed") continue;
        expect(view.arrivals.length).toBeGreaterThanOrEqual(1);
        expect(view.arrivals[0].clock).toMatch(/^\d\d:\d\d$/);
        expect(view.arrivals[0].at).toBeGreaterThanOrEqual(now - 30_000);
        expect(view.plusMinus).toBeGreaterThanOrEqual(1);
        const html = renderToStaticMarkup(createElement(DirectionTimes, { view, now }));
        expect(html).toMatch(/≈\d\d:\d\d/);
        expect(html).toContain("Estimate");
        expect(html).toContain("no board reading yet today");
        expect(html).not.toMatch(/Every ~|Wait 0–/);
      }
  });

  it("widens the ± band in the unstable window instead of hiding times", () => {
    const calm = directionView(predict({ station: "EW17", line: "EWL", direction: "TO_EAST", now: at(TUE, "13:05"), observations: [] }), at(TUE, "13:05"), "EWL");
    const shaky = directionView(predict({ station: "EW17", line: "EWL", direction: "TO_EAST", now: at(TUE, "09:40"), observations: [] }), at(TUE, "09:40"), "EWL");
    expect(calm.state === "estimate" && shaky.state === "estimate").toBe(true);
    if (calm.state !== "estimate" || shaky.state !== "estimate") return;
    expect(shaky.unstable).toBe(true);
    expect(shaky.plusMinus!).toBeGreaterThan(calm.plusMinus!);
    expect(shaky.plusMinus!).toBeGreaterThanOrEqual(3);
    expect(shaky.reason.code).toBe("unstable_gap");
    const html = renderToStaticMarkup(createElement(DirectionTimes, { view: shaky, now: at(TUE, "09:40") }));
    expect(html).toMatch(/≈\d\d:\d\d<span[^>]*>±\d/);
    expect(html).toContain("Times shift day to day at this hour");
  });

  it("keeps estimated times steady between renders so the countdown counts down", () => {
    const now = at(TUE, "13:05");
    const a = gridArrivals(6, now, "EWL");
    const b = gridArrivals(6, now + 40_000, "EWL");
    expect(b[0]).toBe(a[0]);
    expect(a[1] - a[0]).toBe(6 * MINUTE);
    const v1 = directionView(predict({ station: "EW17", line: "EWL", direction: "TO_EAST", now, observations: [] }), now, "EWL");
    const v2 = directionView(predict({ station: "EW17", line: "EWL", direction: "TO_EAST", now: now + 2 * MINUTE, observations: [] }), now + 2 * MINUTE, "EWL");
    if (v1.state === "closed" || v2.state === "closed") throw new Error("closed");
    if (v1.arrivals[0].inMin >= 2) expect(v2.arrivals[0].at).toBe(v1.arrivals[0].at);
  });

  it("a reading's next train is exact (±1); its later trains read ≈ ±2 (board countdowns ±1.5)", () => {
    const now = at(TUE, "10:23");
    const obs: Observation = { station: "EW17", line: "EWL", direction: "TO_EAST", capturedAt: at(TUE, "10:20"), minutes: [4, 9], source: "owner", status: "approved" };
    const view = directionView(predict({ station: "EW17", line: "EWL", direction: "TO_EAST", now, observations: [obs] }), now, "EWL");
    expect(view.state).toBe("exact");
    if (view.state !== "exact") return;
    expect(view.arrivals.map((a) => a.clock)).toEqual(["10:24", "10:29", "10:34"]);
    expect(view.arrivals.map((a) => a.plusMinus)).toEqual([null, 2, 2]);
    expect(view.plusMinus).toBeNull();
    const html = renderToStaticMarkup(createElement(DirectionTimes, { view, now }));
    expect(html).toContain(">10:24<");
    expect(html).toContain("≈10:29");
    expect(html).toContain("in 1 min");
    expect(html).toContain("From a board reading 3 min ago");
  });

  it("shows closed outside service hours", () => {
    const now = at(TUE, "02:00");
    expect(directionView(predict({ station: "EW17", line: "EWL", direction: "TO_EAST", now, observations: [] }), now, "EWL")).toEqual({ state: "closed" });
  });
});

describe("quick board entry", () => {
  it("chips fill the next empty box; tapping a filled box clears it", () => {
    let s = emptySlots();
    s = fillNextSlot(s, 5, 2);
    s = fillNextSlot(s, 2, 2);
    s = fillNextSlot(s, 9, 2); // no third box open
    expect(s).toEqual([5, 2, null]);
    expect(clearSlot(s, 0)).toEqual([2, null, null]);
    expect(fillNextSlot(s, 9, 3)).toEqual([5, 2, 9]);
  });

  it("posts exactly { station, direction, minutes[], seenAt≈now }", async () => {
    const now = Date.now();
    const payload = buildReadingPost({ station: "EW17", direction: "TO_EAST", slots: [5, 2, null], seenAt: now, now })!;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: 41, status: "approved", line: "EWL" }), { status: 201 }));
    const result = await postReading(payload, { fetch: fetchMock });
    expect(result).toEqual({ kind: "approved", id: 41, line: "EWL" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/readings");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["direction", "minutes", "seenAt", "station"]);
    expect(body).toMatchObject({ station: "EW17", direction: "TO_EAST", minutes: [2, 5] });
    expect(Math.abs(Date.parse(body.seenAt) - now)).toBeLessThan(1000);
    expect(new Headers(init.headers).get("x-device-id")).toBeNull();
  });

  it("time seen defaults to now and can go back at most 30 min", () => {
    const now = at(TUE, "10:30");
    expect(clampSeenAt(now - 45 * MINUTE, now)).toBe(now - 30 * MINUTE);
    expect(clampSeenAt(now + 5 * MINUTE, now)).toBe(now);
    const p = buildReadingPost({ station: "EW17", direction: "TO_EAST", slots: [3, null, null], seenAt: now - 10 * MINUTE, now })!;
    expect(sgtClock(Date.parse(p.seenAt))).toBe("10:20");
    expect(buildReadingPost({ station: "EW17", direction: "TO_EAST", slots: emptySlots(), seenAt: now, now })).toBeNull();
  });

  it("after a saved reading the card switches from estimate to exact", () => {
    const now = at(TUE, "09:40"); // unstable window, no reading yet today
    const ctx = { station: "EW17", line: "EWL", direction: "TO_EAST", now };
    const server = predict({ ...ctx, observations: [] });
    expect(directionView(server, now, "EWL").state).toBe("estimate");

    const payload = buildReadingPost({ station: "EW17", direction: "TO_EAST", slots: [2, 6, null], seenAt: now, now })!;
    const mine = localObservation(payload, "EWL", 7);
    // Optimistic: the saver's own card at once…
    const local = directionView(withLocalReading(server, mine, ctx), now, "EWL");
    expect(local.state).toBe("exact");
    if (local.state === "exact") expect(local.arrivals.map((a) => a.clock)).toEqual(["09:42", "09:46", "09:50"]);
    // …and everyone's after the re-fetch once the reading is approved.
    const refetched = predict({ ...ctx, observations: [{ ...mine, status: "approved" }] });
    expect(directionView(refetched, now + 5000, "EWL").state).toBe("exact");
    // Another platform's reading never changes this card.
    expect(withLocalReading(server, { ...mine, station: "EW16" }, ctx)).toBe(server);
  });
});
