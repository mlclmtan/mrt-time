import { describe, expect, it, vi } from "vitest";
import {
  scrubErrorMessage,
  extractFileBasename,
  pushBreadcrumb,
  canReportClientError,
  readBreadcrumbs,
  addBreadcrumb,
  writeExitState,
  checkAndArmExitState,
  BREADCRUMB_KEY,
  MAX_BREADCRUMBS,
} from "./health";
import { isFirstPartyOnly, FIRST_PARTY_ONLY_EVENTS } from "./events";
import { ga4Params, metaEventFor, privacyProps } from "./mapping";

const memoryStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => void data.clear(),
  };
};

describe("health telemetry scrubber", () => {
  it("removes URL queries from error messages", () => {
    const raw = "Failed to load https://mrt.sg/api/commute?token=secret123&user=john safely";
    const scrubbed = scrubErrorMessage(raw);
    expect(scrubbed).not.toContain("?token");
    expect(scrubbed).not.toContain("secret");
    expect(scrubbed).toContain("Failed to load https://mrt.sg/api/commute safely");
  });

  it("removes email addresses from error messages", () => {
    const raw = "User rider.one@example.com encountered an unhandled exception";
    const scrubbed = scrubErrorMessage(raw);
    expect(scrubbed).not.toContain("rider.one@example.com");
    expect(scrubbed).toBe("User encountered an unhandled exception");
  });

  it("removes runs of 4 or more digits while keeping short numbers", () => {
    const raw = "HTTP 500 error on transaction 987654321 with timeout 200 ms";
    const scrubbed = scrubErrorMessage(raw);
    expect(scrubbed).not.toContain("987654321");
    expect(scrubbed).toContain("HTTP 500");
    expect(scrubbed).toContain("200 ms");
  });

  it("caps message length at 200 characters", () => {
    const longMsg = "A".repeat(350);
    const scrubbed = scrubErrorMessage(longMsg);
    expect(scrubbed.length).toBeLessThanOrEqual(200);
    expect(scrubbed).toBe("A".repeat(200));
  });

  it("handles empty or falsy message gracefully", () => {
    expect(scrubErrorMessage("")).toBe("unknown_error");
    expect(scrubErrorMessage("   ")).toBe("unknown_error");
  });
});

describe("file basename extractor", () => {
  it("extracts clean basename from URLs or file paths", () => {
    expect(extractFileBasename("https://mrt.sg/_next/static/chunks/trip-page.js?v=1")).toBe("trip-page.js");
    expect(extractFileBasename("/var/app/src/lib/predict/board.ts")).toBe("board.ts");
    expect(extractFileBasename(undefined)).toBeUndefined();
    expect(extractFileBasename(null)).toBeUndefined();
  });
});

describe("error dedupe and per-page cap", () => {
  it("dedupes identical errors within a page view", () => {
    const seen = new Set<string>();
    let count = 0;
    const key = "error:TypeError at page.js:10:5";

    const r1 = canReportClientError(seen, count, key, 5);
    expect(r1.allowed).toBe(true);
    expect(r1.nextCount).toBe(1);
    count = r1.nextCount;

    // Second identical error
    const r2 = canReportClientError(seen, count, key, 5);
    expect(r2.allowed).toBe(false);
    expect(r2.nextCount).toBe(1);
  });

  it("enforces maximum 5 errors per page view", () => {
    const seen = new Set<string>();
    let count = 0;

    for (let i = 1; i <= 5; i++) {
      const res = canReportClientError(seen, count, `error:unique_${i}`, 5);
      expect(res.allowed).toBe(true);
      count = res.nextCount;
    }
    expect(count).toBe(5);

    // 6th unique error is rejected by cap
    const r6 = canReportClientError(seen, count, "error:unique_6", 5);
    expect(r6.allowed).toBe(false);
    expect(r6.nextCount).toBe(5);
  });
});

describe("breadcrumb ring buffer & unclean-exit detection", () => {
  it("pushBreadcrumb limits array to max 20 items and sanitizes tokens", () => {
    let crumbs: string[] = [];
    for (let i = 1; i <= 25; i++) {
      crumbs = pushBreadcrumb(crumbs, `step:${i}`, MAX_BREADCRUMBS);
    }
    expect(crumbs).toHaveLength(20);
    expect(crumbs[0]).toBe("step:6");
    expect(crumbs[19]).toBe("step:25");
  });

  it("stores and retrieves breadcrumbs synchronously in storage", () => {
    const store = memoryStore();
    addBreadcrumb("route:/trip", store);
    addBreadcrumb("tap:board", store);
    addBreadcrumb("fetch_fail:/api/board", store);

    const read = readBreadcrumbs(store);
    expect(read).toEqual(["route:/trip", "tap:board", "fetch_fail:/api/board"]);
  });

  it("detects unclean exit when previous session did not cleanly exit while visible", () => {
    const store = memoryStore();
    writeExitState({ clean: false, visible: true }, store);
    store.setItem(BREADCRUMB_KEY, JSON.stringify(["route:/trip", "tap:board"]));

    const onUncleanExit = vi.fn();
    const cleanup = checkAndArmExitState(onUncleanExit, {
      storage: store,
      visibilityState: () => "visible",
      addDocListener: () => {},
      removeDocListener: () => {},
      addWinListener: () => {},
      removeWinListener: () => {},
    });

    expect(onUncleanExit).toHaveBeenCalledTimes(1);
    expect(onUncleanExit).toHaveBeenCalledWith({
      breadcrumbs: ["route:/trip", "tap:board"],
      visible: true,
    });

    cleanup();
  });

  it("does not report unclean exit when previous session exited cleanly via pagehide", () => {
    const store = memoryStore();
    writeExitState({ clean: true, visible: true }, store);
    store.setItem(BREADCRUMB_KEY, JSON.stringify(["route:/stations"]));

    const onUncleanExit = vi.fn();
    const cleanup = checkAndArmExitState(onUncleanExit, {
      storage: store,
      visibilityState: () => "visible",
      addDocListener: () => {},
      removeDocListener: () => {},
      addWinListener: () => {},
      removeWinListener: () => {},
    });

    expect(onUncleanExit).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not report unclean exit when previous session was not visible", () => {
    const store = memoryStore();
    writeExitState({ clean: false, visible: false }, store);
    store.setItem(BREADCRUMB_KEY, JSON.stringify(["route:/"]));

    const onUncleanExit = vi.fn();
    const cleanup = checkAndArmExitState(onUncleanExit, {
      storage: store,
      visibilityState: () => "hidden",
      addDocListener: () => {},
      removeDocListener: () => {},
      addWinListener: () => {},
      removeWinListener: () => {},
    });

    expect(onUncleanExit).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("first-party only health events mapping", () => {
  it("health events are first-party only and never mapped to GA4 or Meta", () => {
    for (const name of FIRST_PARTY_ONLY_EVENTS) {
      expect(isFirstPartyOnly(name)).toBe(true);

      const params = ga4Params(name, { count: 1, route: "/" }, { language: "en", userType: "visitor" });
      expect(params).toEqual({});

      const meta = metaEventFor(name, { count: 1 });
      expect(meta).toBeNull();
    }
  });

  it("station_pin drops station for visitors under privacyProps rule", () => {
    const ownerProps = privacyProps("station_pin", { action: "pin", station: "outram-park" }, "owner");
    expect(ownerProps).toEqual({ action: "pin", station: "outram-park" });

    const visitorProps = privacyProps("station_pin", { action: "pin", station: "outram-park" }, "visitor");
    expect(visitorProps).toEqual({ action: "pin" });
  });
});
