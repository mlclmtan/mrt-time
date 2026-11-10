import { describe, expect, it } from "vitest";
import { MINUTE, sgtClock, sgtInstant } from "../time";
import { BANDS, bandHeadway, inUnstableWindow, predict, projectHistorical, timeBand } from ".";
import type { Observation } from ".";
import { scorePrediction, summariseAccuracy } from "./accuracy";
import { MemoryRateLimiter, PUBLIC_IP_LIMIT, PUBLIC_READING_LIMIT, autoApprovalStatus, hitPublicLimits, rateLimitKey } from "./readings";

// Synthetic fixtures only. 2026-11-02 is a Monday; 2026-11-07 a Saturday.
const MON = "2026-11-02";
const at = (date: string, clock: string, seconds = 0) => sgtInstant(date, clock) + seconds * 1000;
const reading = (date: string, clock: string, minutes: number[], extra: Partial<Observation> = {}): Observation => ({
  station: "EW17",
  line: "EWL",
  direction: "TO_EAST",
  capturedAt: at(date, clock),
  minutes,
  source: "owner",
  status: "approved",
  ...extra,
});
const base = { line: "EWL", direction: "TO_EAST", station: "EW17" };
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected) / MINUTE).toBeLessThanOrEqual(0.1);

describe("same-day anchor", () => {
  it("projects a 10:21 [1,5,10] reading: at 10:24 the next trains are 10:26 and 10:31", () => {
    const p = predict({ ...base, now: at(MON, "10:24"), observations: [reading(MON, "10:21", [1, 5, 10])] });
    expect(p.kind).toBe("times");
    expect(p.basis).toBe("same_day");
    // The board's 2nd and 3rd trains are ±1.5 (v2.1 error model): "≈", medium.
    expect(p.confidence).toBe("medium");
    expect(p.arrivals.slice(0, 2).map((a) => a.errMin)).toEqual([1.5, 1.5]);
    near(p.arrivals[0].at, at(MON, "10:26"));
    near(p.arrivals[1].at, at(MON, "10:31"));
    expect(p.arrivals[0].inMin).toBeCloseTo(2, 1);
    expect(p.reason).toEqual({ code: "reading_ago", params: { minutes: 3 } });
  });

  it("steps beyond the shown trains by the reading's headway", () => {
    const p = predict({ ...base, now: at(MON, "11:00"), observations: [reading(MON, "10:40", [2, 7])] });
    // 10:42, 10:47 shown; headway 5 → 10:52, 10:57, 11:02 … Four gaps on, 11:02 is ≈ ±2.5
    // (= half the gap); 11:07 would be ±3, too vague to tell trains apart, so it isn't listed.
    near(p.arrivals[0].at, at(MON, "11:02"));
    expect(p.arrivals.map((a) => a.errMin)).toEqual([2.5]);
    expect(p.confidence).toBe("medium");
  });

  it("ignores readings older than 90 minutes, pending readings and the other direction / line", () => {
    // v2: a reading at another station of the same line and direction now
    // counts (the same trains pass here) — see sightings.test.ts.
    const observations = [
      reading(MON, "08:00", [1, 4]),
      reading(MON, "10:50", [1, 4], { status: "pending" }),
      reading(MON, "10:50", [1, 4], { station: "EW15", direction: "TO_WEST" }),
      reading(MON, "10:50", [1, 4], { station: "TE17", line: "TEL", direction: "TO_BAYSHORE" }),
    ];
    const p = predict({ ...base, now: at(MON, "11:00"), observations });
    expect(p.basis).not.toBe("same_day");
  });
});

describe("unstable window", () => {
  it("weekday 09:15–10:30 without a same-day reading gives a range, never clock times", () => {
    const otherDay = reading("2026-10-30", "10:22", [2, 7]);
    const now = at(MON, "10:00");
    expect(inUnstableWindow(now, "EWL")).toBe(true);
    const p = predict({ ...base, now, observations: [otherDay] });
    expect(p.kind).toBe("range");
    expect(p.arrivals).toEqual([]);
    expect(p.unstable).toBe(true);
    expect(p.reason.code).toBe("unstable_window");
    expect(p.waitMin.max).toBeGreaterThan(0);
  });

  it("is editable data: a custom window list switches it off", () => {
    const p = predict({
      ...base,
      now: at(MON, "10:00"),
      observations: [reading("2026-10-30", "10:22", [2, 7])],
      unstableWindows: [],
    });
    expect(p.kind).toBe("times");
    expect(p.basis).toBe("historical");
  });

  it("weekends are not affected by the weekday window", () => {
    expect(inUnstableWindow(at("2026-11-07", "10:00"), "EWL")).toBe(false);
  });
});

/**
 * Reference: v0 `predictDirection` (lib/predict.js), kept verbatim in
 * behaviour (Intl-based Singapore parts) to check the TypeScript port.
 */
function v0Predict(observations: { capturedAt: string; nextMin: number; nextNextMin: number | null }[], now: Date) {
  const sgParts = (date: Date) => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      hour12: false,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
    const tod = (+p.hour % 24) * 60 + +p.minute + +p.second / 60;
    return { tod, isWeekend: p.weekday === "Sat" || p.weekday === "Sun" };
  };
  const circ = (a: number, b: number) => {
    let d = (((a - b) % 1440) + 1440) % 1440;
    if (d > 720) d -= 1440;
    return d;
  };
  const enriched = observations.map((o) => {
    const cap = sgParts(new Date(o.capturedAt));
    return {
      captureTod: cap.tod,
      isWeekend: cap.isWeekend,
      arrivalTod: cap.tod + o.nextMin,
      headway: o.nextNextMin != null ? o.nextNextMin - o.nextMin : null,
    };
  });
  const nowP = sgParts(now);
  const sameType = enriched.filter((o) => o.isWeekend === nowP.isWeekend);
  const pool = sameType.length ? sameType : enriched;
  let anchor = pool[0];
  let best = Math.abs(circ(pool[0].captureTod, nowP.tod));
  for (const o of pool) {
    const d = Math.abs(circ(o.captureTod, nowP.tod));
    if (d < best) {
      best = d;
      anchor = o;
    }
  }
  const hs = enriched.map((o) => o.headway).filter((h): h is number => h != null).sort((a, b) => a - b);
  const med = hs.length ? (hs.length % 2 ? hs[(hs.length - 1) / 2] : (hs[hs.length / 2 - 1] + hs[hs.length / 2]) / 2) : null;
  const headway = anchor.headway ?? med ?? 5;
  const gap = nowP.tod - anchor.arrivalTod;
  let k = Math.ceil(gap / headway);
  let mins = anchor.arrivalTod + k * headway - nowP.tod;
  if (mins < -1e-6) {
    k += 1;
    mins = anchor.arrivalTod + k * headway - nowP.tod;
  }
  const anchorGap = Math.abs(circ(anchor.captureTod, nowP.tod));
  const confidence = anchorGap <= 30 && sameType.length > 0 ? "high" : anchorGap <= 120 ? "medium" : "low";
  return { minsToNext: Math.max(0, mins), headway, confidence };
}

describe("historical clock-time repeat (v0 port)", () => {
  it("projects another day's reading forward by its headway", () => {
    const obs = [reading("2026-10-28", "14:05", [3, 8])]; // arrival 14:08, every 5
    const now = at(MON, "14:20");
    const h = projectHistorical(obs, now)!;
    expect(h.minsToNext).toBeCloseTo(3); // 14:23
    expect(h.minsToNextNext).toBeCloseTo(8);
    expect(h.confidence).toBe("high");
    const p = predict({ ...base, now, observations: obs });
    expect(p.basis).toBe("historical");
    expect(p.confidence).toBe("medium"); // capped below same-day
    expect(sgtClock(p.arrivals[0].at)).toBe("14:23");
    expect(sgtClock(p.arrivals[1].at)).toBe("14:28");
  });

  it("prefers the same day-type and falls back to all readings", () => {
    const weekend = reading("2026-10-31", "14:10", [1, 7]);
    const weekday = reading("2026-10-28", "12:00", [2, 6]);
    const sat = projectHistorical([weekend, weekday], at("2026-11-07", "14:00"))!;
    expect(sat.anchor).toBe(weekend);
    const onlyWeekend = projectHistorical([weekend], at(MON, "14:00"))!;
    expect(onlyWeekend.dayTypeMatch).toBe(false);
    expect(onlyWeekend.confidence).toBe("medium");
  });

  it("matches the v0 reference on synthetic data", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const count = 1 + Math.floor(rand() * 4);
      const obs: Observation[] = [];
      for (let j = 0; j < count; j++) {
        const day = `2026-10-${String(19 + Math.floor(rand() * 12)).padStart(2, "0")}`;
        const minute = 360 + Math.floor(rand() * 960);
        const clock = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
        const first = 1 + Math.floor(rand() * 6);
        const second = rand() < 0.3 ? null : first + 2 + Math.floor(rand() * 6);
        obs.push(reading(day, clock, second == null ? [first] : [first, second]));
      }
      const nowMinute = 420 + Math.floor(rand() * 840);
      const now = at(MON, "00:00") + nowMinute * MINUTE + Math.floor(rand() * 60) * 1000;
      const ours = projectHistorical(obs, now)!;
      const ref = v0Predict(
        obs.map((o) => ({
          capturedAt: new Date(o.capturedAt).toISOString(),
          nextMin: o.minutes[0],
          nextNextMin: o.minutes[1] ?? null,
        })),
        new Date(now),
      );
      expect(ours.minsToNext).toBeCloseTo(ref.minsToNext, 6);
      expect(ours.headway).toBe(ref.headway);
      expect(ours.confidence).toBe(ref.confidence);
    }
  });

  it("ignores anchors more than two hours away in time-of-day", () => {
    const p = predict({ ...base, now: at(MON, "20:00"), observations: [reading("2026-10-28", "14:05", [3, 8])] });
    expect(p.kind).toBe("range");
  });
});

describe("time-band headway", () => {
  it("falls back to LTA bands: peak 2–3 min, off-peak 5–7 min", () => {
    const peak = bandHeadway([], "EWL", "TO_EAST", at(MON, "08:00"));
    expect(peak.source).toBe("fallback");
    expect(peak.headway).toBeGreaterThanOrEqual(2);
    expect(peak.headway).toBeLessThanOrEqual(3);
    const off = bandHeadway([], "EWL", "TO_EAST", at(MON, "14:00"));
    expect(off.headway).toBeGreaterThanOrEqual(5);
    expect(off.headway).toBeLessThanOrEqual(7);
    expect(timeBand(at(MON, "18:00"))).toBe("weekday_pm_peak");
    expect(timeBand(at("2026-11-07", "08:00"))).toBe("weekend");
    expect(BANDS.weekend.range).toEqual([5, 7]);
  });

  it("uses the observed median once ≥ 2 readings in the band exist", () => {
    const one = [reading("2026-10-28", "13:00", [2, 6])];
    expect(bandHeadway(one, "EWL", "TO_EAST", at(MON, "14:00")).source).toBe("fallback");
    const two = [...one, reading("2026-10-29", "15:00", [1, 6])];
    const observed = bandHeadway(two, "EWL", "TO_EAST", at(MON, "14:00"));
    expect(observed).toMatchObject({ source: "observed", headway: 4.5, count: 2 });
    // Readings from another band don't count.
    const peakOnly = [reading("2026-10-28", "08:00", [1, 3]), reading("2026-10-29", "08:10", [1, 3])];
    expect(bandHeadway(peakOnly, "EWL", "TO_EAST", at(MON, "14:00")).source).toBe("fallback");
  });

  it("explains the range with the typical gap when nothing else is known", () => {
    const p = predict({ ...base, now: at(MON, "14:00"), observations: [] });
    expect(p).toMatchObject({ kind: "range", confidence: "low", reason: { code: "typical_gap" } });
  });

  it("reports closed outside service hours", () => {
    const p = predict({ ...base, now: at(MON, "02:00"), observations: [] });
    expect(p.kind).toBe("closed");
  });
});

describe("public reading auto-approval", () => {
  const approved = [reading(MON, "10:00", [2, 7])]; // trains 10:02, 10:07, every 5
  it("approves a reading within ±2 min of an approved reading in the same 30-min window", () => {
    // At 10:15 board shows 2 → 10:17, implied 10:17 ✓
    expect(autoApprovalStatus({ ...base, capturedAt: at(MON, "10:15"), minutes: [2, 7] }, approved)).toBe("approved");
    // 10:15 shows 4 → 10:19, 2 min off 10:17 ✓
    expect(autoApprovalStatus({ ...base, capturedAt: at(MON, "10:15"), minutes: [4] }, approved)).toBe("approved");
  });
  it("leaves inconsistent or out-of-window readings pending", () => {
    // Next train 10:14:30 sits 2.5 min from both 10:12 and 10:17.
    expect(
      autoApprovalStatus({ ...base, capturedAt: at(MON, "10:14", 30), minutes: [0] }, approved),
    ).toBe("pending");
    expect(autoApprovalStatus({ ...base, capturedAt: at(MON, "10:45"), minutes: [2] }, approved)).toBe("pending");
    expect(autoApprovalStatus({ ...base, station: "EW15", capturedAt: at(MON, "10:15"), minutes: [2] }, approved)).toBe(
      "pending",
    );
    expect(autoApprovalStatus({ ...base, capturedAt: at(MON, "10:15"), minutes: [2] }, [])).toBe("pending");
  });
  it("accepts agreement with a predicted arrival", () => {
    expect(
      autoApprovalStatus({ ...base, capturedAt: at(MON, "10:15"), minutes: [3] }, [], [at(MON, "10:19")]),
    ).toBe("approved");
  });
  it("rate limits to 10 per hour per device + IP hash", async () => {
    const limiter = new MemoryRateLimiter();
    const key = rateLimitKey("device-a", "iphash-1");
    const t0 = at(MON, "10:00");
    for (let i = 0; i < 10; i++) expect((await limiter.hit(key, t0 + i * MINUTE)).allowed).toBe(true);
    expect((await limiter.hit(key, t0 + 11 * MINUTE)).allowed).toBe(false);
    expect((await limiter.hit(rateLimitKey("device-b", "iphash-1"), t0)).allowed).toBe(true);
    expect((await limiter.hit(key, t0 + 61 * MINUTE)).allowed).toBe(true);
  });
  it("rotating device ids can't get past 20 per hour per network (F7)", async () => {
    const limiters = { device: new MemoryRateLimiter(PUBLIC_READING_LIMIT), ip: new MemoryRateLimiter(PUBLIC_IP_LIMIT) };
    const t0 = at(MON, "10:00");
    const results = [];
    for (let i = 0; i < 25; i++) results.push(await hitPublicLimits(limiters, `rotating-${i}`, "iphash-1", t0 + i * 1000));
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
    expect(results.at(-1)).toEqual({ allowed: false, bucket: "ip" });
    // Another network is unaffected; one device is still held to 10.
    expect((await hitPublicLimits(limiters, "rotating-0", "iphash-2", t0)).allowed).toBe(true);
    const own = { device: new MemoryRateLimiter(PUBLIC_READING_LIMIT), ip: new MemoryRateLimiter(PUBLIC_IP_LIMIT) };
    for (let i = 0; i < 10; i++) await hitPublicLimits(own, "same-device", "iphash-3", t0);
    expect(await hitPublicLimits(own, "same-device", "iphash-3", t0)).toEqual({ allowed: false, bucket: "device" });
  });
});

describe("accuracy", () => {
  it("scores the nearest predicted train within ±1 min as a hit", () => {
    const p = predict({ ...base, now: at(MON, "10:24"), observations: [reading(MON, "10:21", [1, 5, 10])] });
    expect(scorePrediction(p, at(MON, "10:26", 40)).hit).toBe(true);
    expect(scorePrediction(p, at(MON, "10:28", 30)).hit).toBe(false);
    expect(scorePrediction({ kind: "range", arrivals: [] }, at(MON, "10:26")).hit).toBeNull();
    const summary = summariseAccuracy(
      [
        { line: "EWL", station: "EW17", band: "weekday_offpeak", hit: true },
        { line: "EWL", station: "EW17", band: "weekday_offpeak", hit: false },
        { line: "TEL", station: "TE17", band: "weekday_offpeak", hit: true },
        { line: "TEL", station: "TE17", band: "weekday_offpeak", hit: null },
      ],
      "line",
    );
    expect(summary).toEqual([
      { key: "EWL", scored: 2, hits: 1, rate: 0.5 },
      { key: "TEL", scored: 1, hits: 1, rate: 1 },
    ]);
  });
});

describe("v1 compatibility and the kill switch (F11, F12)", () => {
  const strip = (p: ReturnType<typeof predict>) => ({ kind: p.kind, basis: p.basis, at: p.arrivals.map((a) => a.at), headway: p.headwayMin, reason: p.reason.code });
  it("with no sightings and no same-day reading, v2 predicts exactly what v1 did", () => {
    const history = [reading("2026-10-27", "13:10", [2, 8]), reading("2026-10-28", "13:40", [1, 7]), reading("2026-10-29", "09:40", [3, 9])];
    const scenarios = [
      { now: at(MON, "13:15"), observations: history }, // another day's clock time (outside unstable windows)
      { now: at(MON, "09:40"), observations: history }, // weekday 09:15–10:30 window: a range
      { now: at(MON, "15:00"), observations: [] }, // nothing known: typical gap
      { now: at("2026-11-07", "11:00"), observations: history }, // Saturday
      { now: at(MON, "02:00"), observations: history }, // not running
    ];
    for (const s of scenarios) {
      const v2 = predict({ ...base, ...s, sightings: [] });
      const v1 = predict({ ...base, ...s, engine: "v1" });
      expect(strip(v2), sgtClock(s.now)).toEqual(strip(v1));
    }
  });

  it("a fresh reading's next train is the same in v1 and v2", () => {
    const observations = [reading(MON, "10:21", [3, 8])];
    const now = at(MON, "10:22");
    expect(predict({ ...base, now, observations }).arrivals[0].at).toBe(predict({ ...base, now, observations, engine: "v1" }).arrivals[0].at);
  });

  it("engine v1 ignores sightings and propagation entirely", () => {
    const sightings = [{ station: "EW17", line: "EWL", direction: "TO_EAST", at: at(MON, "11:00"), kind: "boarded" as const, source: "owner" as const, status: "approved" as const }];
    const v2 = predict({ ...base, now: at(MON, "11:01"), observations: [], sightings });
    const v1 = predict({ ...base, now: at(MON, "11:01"), observations: [], sightings, engine: "v1" });
    expect(v2.basis).toBe("same_day");
    expect(v1.basis).toBe("band");
  });
});
