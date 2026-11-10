import { describe, expect, it, vi } from "vitest";
import { QUEUE_KEY, enqueueTap, flushTaps, queuedTaps } from "./queue";
import { buildSightingPost, postSighting, resolveTime, timeSourceOf } from "./client";
import { MINUTE, sgtInstant } from "../time";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};
const now = sgtInstant("2026-11-10", "10:14");

describe("offline tap queue (F11)", () => {
  it("keeps a tap with its own time and sends it when back online", async () => {
    const store = memory();
    const body = { clientId: "c1", kind: "board", at: new Date(now).toISOString(), station: "EW17", direction: "TO_EAST", timeSource: "now" };
    enqueueTap(store, { url: "/api/trip-events", body }, now);
    expect(queuedTaps(store)).toHaveLength(1);
    // Still offline: nothing lost.
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await flushTaps(store, offline, now + MINUTE)).toEqual({ sent: 0, left: 1 });
    // Online: posted with the original tap time.
    const online = vi.fn(async () => new Response("{}", { status: 201 }));
    expect(await flushTaps(store, online, now + 20 * MINUTE)).toEqual({ sent: 1, left: 0 });
    const sent = JSON.parse((online.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.at).toBe(new Date(now).toISOString());
    expect(queuedTaps(store)).toEqual([]);
  });

  it("drops taps the server rejects for good (4xx), retries 5xx, ignores foreign URLs and old taps", async () => {
    const store = memory();
    enqueueTap(store, { url: "/api/sightings", body: { a: 1 } }, now);
    enqueueTap(store, { url: "/api/sightings", body: { a: 2 } }, now);
    expect(enqueueTap(store, { url: "https://evil.example/x", body: {} }, now)).toBeNull();
    const statuses = [400, 503];
    const fetch = vi.fn(async () => new Response("{}", { status: statuses.shift()! }));
    expect(await flushTaps(store, fetch, now)).toEqual({ sent: 1, left: 1 });
    expect(await flushTaps(store, vi.fn(async () => new Response("{}", { status: 201 })), now + 13 * 60 * MINUTE)).toEqual({ sent: 0, left: 0 });
    store.setItem(QUEUE_KEY, "not json");
    expect(queuedTaps(store)).toEqual([]);
  });

  it("a public tap with no connection is queued instead of failing", async () => {
    const queue = vi.fn();
    const post = buildSightingPost({ station: "EW17", direction: "TO_EAST", kind: "boarded", at: now, timeSource: "now" });
    const res = await postSighting(post, {
      fetch: async () => {
        throw new TypeError("offline");
      },
      queue,
    });
    expect(res).toEqual({ kind: "queued" });
    expect(queue).toHaveBeenCalledWith("/api/sightings", post);
  });
});

describe("time chips (F10) and the public 30-min limit (F7)", () => {
  it("Now is a tap at Now; any other chip or picked time is 'chosen'", () => {
    expect(timeSourceOf({ kind: "ago", minutes: 0 })).toBe("now");
    expect(timeSourceOf({ kind: "ago", minutes: 2 })).toBe("chosen");
    expect(timeSourceOf({ kind: "pick", clock: "10:00" })).toBe("chosen");
  });
  it("visitors can't go back more than 30 min", () => {
    expect(resolveTime({ kind: "pick", clock: "09:00" }, now, 30)).toBe(now - 30 * MINUTE);
    expect(resolveTime({ kind: "pick", clock: "09:00" }, now)).toBe(sgtInstant("2026-11-10", "09:00"));
  });
});
