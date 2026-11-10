import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LINES, PLATFORMS } from "../network";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import { predict, type Observation } from "./index";
import { directionView, gridArrivals, lastSeenAt, withLocalReading } from "./board-view";
import { buildReadingPost, fillNextSlot, clearSlot, emptySlots, localObservation, postReading, clampSeenAt } from "../readings/entry";
import { makeT } from "../i18n";
import { formatDay, reasonText } from "../format";
import { DirectionTimes, boardReasonText } from "@/components/board/direction-times";
import { SeenToday } from "@/components/board/seen-today";

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

  describe("v2.1.1 live check (Tue 10 Nov 12:10, a 10:21 reading on Mon 2 Nov, a train seen today at 10:14)", () => {
    const NOV10 = "2026-11-10";
    const monReading: Observation = { station: "EW17", line: "EWL", direction: "TO_EAST", capturedAt: at("2026-11-02", "10:21"), minutes: [3, 8], source: "owner", status: "approved" };
    const ctx = { station: "EW17", line: "EWL", direction: "TO_EAST" };
    const now = at(NOV10, "12:10");
    const p = predict({ ...ctx, now, observations: [monReading] });
    const en = makeT("en");

    it("names the day of another day's reading (not 'another day')", () => {
      expect(p.basis).toBe("historical");
      expect(p.reason.params.date).toBe("2026-11-02");
      const view = directionView(p, now, "EWL");
      if (view.state === "closed") throw new Error("closed");
      expect(boardReasonText(en, view.reason)).toBe("Based on a board reading at 10:21 on Mon 2 Nov, no board reading yet today");
      expect(boardReasonText(makeT("zh-Hant"), view.reason, "zh-Hant")).toBe("根據11月2日（週一） 10:21 的顯示屏讀數，今天尚未有讀數");
      // Planner / Home ride reasons too.
      expect(reasonText(en, p.reason)).toBe("Based on a reading at 10:21 on Mon 2 Nov");
      expect(formatDay("2026-11-02", "en")).toBe("Mon 2 Nov");
    });

    it("with trains seen today that are too old to anchor, says so instead of 'no board reading yet today'", () => {
      const seen = [{ at: at(NOV10, "10:14") }];
      const view = directionView(p, now, "EWL", lastSeenAt(seen, now));
      if (view.state === "closed") throw new Error("closed");
      expect(view.reason).toEqual({ code: "stale_today", seenAt: at(NOV10, "10:14"), basis: { code: "historical_anchor", clock: "10:21", date: "2026-11-02" } });
      const text = boardReasonText(en, view.reason);
      expect(text).toBe("Last train seen today at 10:14 is too long ago to use; estimated from a board reading at 10:21 on Mon 2 Nov");
      expect(text).not.toContain("no board reading yet today");
      // The typical-gap basis reads the same way.
      const band = directionView(predict({ ...ctx, now, observations: [] }), now, "EWL", at(NOV10, "10:14"));
      if (band.state === "closed") throw new Error("closed");
      expect(boardReasonText(en, band.reason)).toMatch(/^Last train seen today at 10:14 is too long ago to use; estimated from the typical gap \(~\d+ min\)$/);
      // Today's trains anchoring the card: no change.
      const fresh = directionView(predict({ ...ctx, now, observations: [{ ...monReading, capturedAt: at(NOV10, "12:08") }] }), now, "EWL", at(NOV10, "10:14"));
      if (fresh.state === "closed") throw new Error("closed");
      expect(fresh.reason.code).toBe("reading_ago");
      // A train seen later than now (heading here) doesn't count as "seen".
      expect(lastSeenAt([{ at: now + MINUTE }], now)).toBeNull();
    });

    it("every ≈ time carries its ± with the unit (Next and Then)", () => {
      const view = directionView(p, now, "EWL");
      const html = renderToStaticMarkup(createElement(DirectionTimes, { view, now }));
      const approx = html.match(/≈\d\d:\d\d/g) ?? [];
      const pm = html.match(/>±\d+ min</g) ?? [];
      expect(approx).toHaveLength(3);
      expect(pm).toHaveLength(3);
      expect(html).not.toMatch(/>±\d+</);
      // Trains seen today: "(±1 min)".
      const seen = renderToStaticMarkup(createElement(SeenToday, { trains: [{ at: at(NOV10, "10:14"), how: "passed", from: "EW15", spreadMin: 1 }] }));
      expect(seen).toContain("(±1 min)");
    });
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
