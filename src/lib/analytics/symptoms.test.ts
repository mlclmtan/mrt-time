import { describe, expect, it } from "vitest";
import {
  evaluateSymptoms,
  calculateMedian,
  SYMPTOM_THRESHOLDS,
  type SymptomData,
} from "./symptoms";
import { parseSince } from "@/app/api/admin/symptoms/route";

describe("symptoms rules engine", () => {
  it("Rule 1: client_error group (msg+file+line) >= 3 in window -> medium", () => {
    // Below threshold (2 occurrences) -> does not fire
    const dataBelow: SymptomData = {
      clientErrorGroups: [{ msg: "TypeError", file: "page.js", line: 10, count: 2 }],
    };
    expect(evaluateSymptoms(dataBelow)).toEqual([]);

    // At threshold (3 occurrences) -> fires with medium severity
    const dataAt: SymptomData = {
      clientErrorGroups: [{ msg: "TypeError", file: "page.js", line: 10, count: 3 }],
    };
    const findings = evaluateSymptoms(dataAt);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "client_error_repeated",
      severity: "medium",
      title: "Repeated client error",
    });
    expect(findings[0].evidence).toContain("3 times");
  });

  it("Rule 2: unclean exits while visible >= 2 -> high", () => {
    // Below threshold (1 unclean exit)
    expect(evaluateSymptoms({ uncleanExitsVisible: 1 })).toEqual([]);

    // At threshold (2 unclean exits)
    const findings = evaluateSymptoms({ uncleanExitsVisible: 2 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "unclean_exits_visible",
      severity: "high",
      title: "Repeated unclean app exits",
    });
    expect(findings[0].evidence).toContain("2 unclean exit");
  });

  it("Rule 3: tap_queue failed or dropped >= 1 -> high", () => {
    // 0 failures
    expect(evaluateSymptoms({ tapQueueFailedOrDropped: 0 })).toEqual([]);

    // 1 failure
    const findings = evaluateSymptoms({ tapQueueFailedOrDropped: 1 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "tap_queue_failures",
      severity: "high",
      title: "Offline tap queue failure or drop",
    });
    expect(findings[0].evidence).toContain("1 tap(s)");
  });

  it("Rule 4: API route p95 > 2 s or 5xx > 5 % -> medium/high", () => {
    // Normal latency & errors
    expect(
      evaluateSymptoms({
        apiLatencies: [{ route: "/api/board", p50: 100, p95: 2000, n: 100, err5xx: 5 }],
      }),
    ).toEqual([]);

    // p95 > 2000 ms -> medium
    const p95High = evaluateSymptoms({
      apiLatencies: [{ route: "/api/board", p50: 150, p95: 2001, n: 100, err5xx: 0 }],
    });
    expect(p95High).toHaveLength(1);
    expect(p95High[0]).toMatchObject({
      id: "api_latency_/api/board",
      severity: "medium",
      title: "API latency high: /api/board",
    });

    // 5xx rate > 5 % (e.g. 6/100 = 6%) -> high
    const errHigh = evaluateSymptoms({
      apiLatencies: [{ route: "/api/commute", p50: 100, p95: 500, n: 100, err5xx: 6 }],
    });
    expect(errHigh).toHaveLength(1);
    expect(errHigh[0]).toMatchObject({
      id: "api_5xx_/api/commute",
      severity: "high",
      title: "API 5xx rate high: /api/commute",
    });
    expect(errHigh[0].evidence).toContain("6.0%");
  });

  it("Rule 5: web vitals p75 LCP > 2500 ms, INP > 200 ms, CLS > 0.1 -> medium", () => {
    // At boundary thresholds -> does not fire
    expect(
      evaluateSymptoms({
        webVitals: [
          { metric: "LCP", p75: 2500, n: 50 },
          { metric: "INP", p75: 200, n: 50 },
          { metric: "CLS", p75: 0.1, n: 50 },
        ],
      }),
    ).toEqual([]);

    // Over thresholds -> fires medium
    const findings = evaluateSymptoms({
      webVitals: [
        { metric: "LCP", p75: 2501, n: 50 },
        { metric: "INP", p75: 205, n: 50 },
        { metric: "CLS", p75: 0.12, n: 50 },
      ],
    });
    expect(findings).toHaveLength(3);
    expect(findings[0]).toMatchObject({ id: "web_vital_lcp", severity: "medium" });
    expect(findings[1]).toMatchObject({ id: "web_vital_inp", severity: "medium" });
    expect(findings[2]).toMatchObject({ id: "web_vital_cls", severity: "medium" });
  });

  it("Rule 6: long task max > 1000 ms -> medium", () => {
    expect(evaluateSymptoms({ longTaskMaxMs: 1000 })).toEqual([]);

    const findings = evaluateSymptoms({ longTaskMaxMs: 1001 });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "long_tasks_jank",
      severity: "medium",
      title: "Main-thread jank (long task > 1000 ms)",
    });
    expect(findings[0].evidence).toContain("1001 ms");
  });

  it("Rule 7: tap_correction / trip_tap > 30 % (>= 10 taps) -> medium 'tap time often wrong'", () => {
    // High ratio but < 10 taps -> does not fire
    expect(
      evaluateSymptoms({
        tripTapCount: 9,
        tapCorrectionCount: 5, // 55%
      }),
    ).toEqual([]);

    // 10 taps, exactly 30% -> does not fire
    expect(
      evaluateSymptoms({
        tripTapCount: 10,
        tapCorrectionCount: 3, // 30%
      }),
    ).toEqual([]);

    // 10 taps, 4 corrections (40% > 30%) -> fires medium
    const findings = evaluateSymptoms({
      tripTapCount: 10,
      tapCorrectionCount: 4,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "tap_time_often_wrong",
      severity: "medium",
      title: "Tap time often wrong",
    });
    expect(findings[0].evidence).toContain("40.0%");
  });

  it("Rule 8: tap_undo / trip_tap > 15 % -> medium", () => {
    // 20 taps, 3 undos (15%) -> does not fire
    expect(
      evaluateSymptoms({
        tripTapCount: 20,
        tapUndoCount: 3,
      }),
    ).toEqual([]);

    // 20 taps, 4 undos (20% > 15%) -> fires medium
    const findings = evaluateSymptoms({
      tripTapCount: 20,
      tapUndoCount: 4,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "tap_undo_rate_high",
      severity: "medium",
      title: "Frequent tap undos",
    });
    expect(findings[0].evidence).toContain("20.0%");
  });

  it("Rule 9: median trip_tap per trip day > 6 -> low 'trip still takes many taps'", () => {
    // Median 6 -> does not fire
    expect(evaluateSymptoms({ tripTapsPerDay: [4, 6, 7] })).toEqual([]);

    // Median 7 (> 6) -> fires low
    const findings = evaluateSymptoms({ tripTapsPerDay: [5, 7, 9] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      id: "trip_many_taps",
      severity: "low",
      title: "Trip still takes many taps",
    });
    expect(findings[0].evidence).toContain("Median trip_tap per trip day is 7");
  });
});

describe("median calculation", () => {
  it("calculates correct median for odd and even length arrays", () => {
    expect(calculateMedian([])).toBe(0);
    expect(calculateMedian([5])).toBe(5);
    expect(calculateMedian([3, 1, 9])).toBe(3);
    expect(calculateMedian([10, 20, 30, 40])).toBe(25);
  });
});

describe("SYMPTOM_THRESHOLDS", () => {
  it("exports expected threshold constants", () => {
    expect(SYMPTOM_THRESHOLDS.clientErrorGroupMin).toBe(3);
    expect(SYMPTOM_THRESHOLDS.uncleanExitsVisibleMin).toBe(2);
    expect(SYMPTOM_THRESHOLDS.tapQueueFailedOrDroppedMin).toBe(1);
    expect(SYMPTOM_THRESHOLDS.apiLatencyP95Ms).toBe(2000);
    expect(SYMPTOM_THRESHOLDS.api5xxPct).toBe(0.05);
    expect(SYMPTOM_THRESHOLDS.lcpP75Ms).toBe(2500);
    expect(SYMPTOM_THRESHOLDS.inpP75Ms).toBe(200);
    expect(SYMPTOM_THRESHOLDS.clsP75).toBe(0.1);
    expect(SYMPTOM_THRESHOLDS.longTaskMaxMs).toBe(1000);
    expect(SYMPTOM_THRESHOLDS.tapCorrectionRatio).toBe(0.3);
    expect(SYMPTOM_THRESHOLDS.tapCorrectionMinTaps).toBe(10);
    expect(SYMPTOM_THRESHOLDS.tapUndoRatio).toBe(0.15);
    expect(SYMPTOM_THRESHOLDS.tripTapPerDayMedianMax).toBe(6);
  });
});

describe("parseSince helper", () => {
  it("parses 24h, 7d, 30d relative windows", () => {
    const fixedNow = 1_700_000_000_000;
    const r24h = parseSince("24h", fixedNow);
    expect(r24h.to.getTime() - r24h.from.getTime()).toBe(24 * 3600 * 1000);

    const r7d = parseSince("7d", fixedNow);
    expect(r7d.to.getTime() - r7d.from.getTime()).toBe(7 * 24 * 3600 * 1000);

    const r30d = parseSince("30d", fixedNow);
    expect(r30d.to.getTime() - r30d.from.getTime()).toBe(30 * 24 * 3600 * 1000);

    // Default when null/empty is 7d
    const rDefault = parseSince(null, fixedNow);
    expect(rDefault.to.getTime() - rDefault.from.getTime()).toBe(7 * 24 * 3600 * 1000);
  });
});
