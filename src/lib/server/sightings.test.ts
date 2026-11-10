/** Trip events ↔ train sightings on a real Postgres (PGlite) with the generated migrations. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { testDb } from "@/test/pglite";
import * as schema from "../db/schema";
import { sgtInstant } from "../time";

const { db } = await testDb();
vi.mock("../db", async (original) => ({ ...(await original<typeof import("../db")>()), getDb: () => db, dbConfigured: () => true }));

const { logTripEvent, updateTripEvent, deleteTripEvent, todaysEvents } = await import("./trips");
const { savePublicSighting, loadSightings } = await import("./sightings");
const { stationBoard } = await import("./board");
const { backfillSightings } = await import("../../../scripts/backfill-sightings");

const USER = "owner-test";
const T = (clock: string) => new Date(sgtInstant("2026-11-10", clock)).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

beforeAll(async () => {
  await db.insert(schema.user).values({ id: USER, name: "Owner", email: "owner@example.test", emailVerified: true, role: "owner" } as never);
});
afterAll(() => vi.restoreAllMocks());

describe("trip events create train sightings", () => {
  it("board/alight with a platform and direction become sightings; other taps don't", async () => {
    const board = await logTripEvent(USER, { clientId: uuid(1), kind: "board", at: T("10:14"), station: "EW17", direction: "TO_EAST" });
    const alight = await logTripEvent(USER, { clientId: uuid(2), kind: "alight", at: T("10:17"), station: "EW16", direction: "TO_EAST" });
    const door = await logTripEvent(USER, { clientId: uuid(3), kind: "door", at: T("10:00") });
    expect(board.sightingId).not.toBeNull();
    expect(alight.sightingId).not.toBeNull();
    expect(door.sightingId).toBeNull();
    const rows = await db.select().from(schema.trainSighting);
    expect(rows.map((r) => [r.station, r.kind, r.source, r.status])).toEqual([
      ["EW17", "boarded", "owner", "approved"],
      ["EW16", "alighted", "owner", "approved"],
    ]);
    // Same clientId again (retry) does nothing.
    expect((await logTripEvent(USER, { clientId: uuid(1), kind: "board", at: T("10:14"), station: "EW17", direction: "TO_EAST" })).id).toBeNull();
  });

  it("timeline edits move the sighting; deletes remove it", async () => {
    const events = await todaysEvents(USER, sgtInstant("2026-11-10", "12:00"));
    const board = events.find((e) => e.kind === "board")!;
    await updateTripEvent(USER, { id: board.id, at: T("10:15") });
    let [s] = await db.select().from(schema.trainSighting).where(eq(schema.trainSighting.tripEventId, board.id));
    expect(new Date(s.at).toISOString()).toBe(T("10:15"));
    await updateTripEvent(USER, { id: board.id, station: "TE17", direction: "TO_BAYSHORE" });
    [s] = await db.select().from(schema.trainSighting).where(eq(schema.trainSighting.tripEventId, board.id));
    expect([s.station, s.line, s.direction]).toEqual(["TE17", "TEL", "TO_BAYSHORE"]);
    // Another user's event can't be touched.
    expect((await updateTripEvent("someone-else", { id: board.id, at: T("09:00") })).ok).toBe(false);
    expect((await deleteTripEvent(USER, board.id)).deleted).toBe(true);
    expect(await db.select().from(schema.trainSighting).where(eq(schema.trainSighting.tripEventId, board.id))).toEqual([]);
  });

  it("backfill is idempotent", async () => {
    await db.delete(schema.trainSighting);
    const first = await backfillSightings(db as never);
    const second = await backfillSightings(db as never);
    expect(first.written).toBe(1); // the remaining alight event
    expect(first.errors).toBe(1); // v2.1: error filled from the event's logging lag
    expect(second.written).toBe(1);
    expect(second.errors).toBe(0); // idempotent: only rows without an error
    expect((await db.select().from(schema.trainSighting)).length).toBe(1);
  });
});

describe("public sightings", () => {
  it("approve when they agree (±2 min) with a known train, else wait for review", async () => {
    const now = sgtInstant("2026-11-10", "10:30");
    // The owner's 10:17 alight at Outram Park (EW16) → the train left Tiong Bahru (EW17) at 10:14.
    const agree = await savePublicSighting({ station: "EW17", direction: "TO_EAST", kind: "boarded", at: T("10:15") }, { deviceId: "device-1234", ipHash: "h", now });
    expect(agree).toMatchObject({ ok: true, status: "approved" });
    const odd = await savePublicSighting({ station: "EW17", direction: "TO_EAST", kind: "boarded", at: T("10:25") }, { deviceId: "device-1234", ipHash: "h", now });
    expect(odd).toMatchObject({ ok: true, status: "pending" });
    const tooOld = await savePublicSighting({ station: "EW17", direction: "TO_EAST", kind: "boarded", at: T("10:00").replace("2026-11-10", "2026-11-09") }, { deviceId: "d", ipHash: "h", now });
    expect(tooOld.ok).toBe(false);
    // Loaded: approved ones, plus public ones awaiting review (they count only when two networks agree).
    expect((await loadSightings(["EWL"], now)).every((s) => s.status === "approved" || (s.status === "pending" && s.source === "public"))).toBe(true);
    // Public taps: at most 30 min back.
    const back40 = await savePublicSighting({ station: "EW17", direction: "TO_EAST", kind: "boarded", at: T("09:50") }, { deviceId: "d", ipHash: "h", now });
    expect(back40.ok).toBe(false);
  });

  it("the station board lists trains seen today, newest first", async () => {
    const board = await stationBoard("outram-park", sgtInstant("2026-11-10", "10:40"));
    const ew = board!.platforms.find((p) => p.code === "EW16")!.directions.find((d) => d.key === "TO_EAST")!;
    expect(ew.seenToday.length).toBeGreaterThan(0);
    expect(ew.seenToday[0].at).toBeGreaterThanOrEqual(ew.seenToday.at(-1)!.at);
    expect(ew.seenToday.some((t) => t.how === "boarded")).toBe(true); // the owner's alight here
    // The public 10:15 boarding at Tiong Bahru is the same train (10:18 here): counted once.
    expect(ew.seenToday.length).toBe(1);
    const tanjongPagar = await stationBoard("tanjong-pagar", sgtInstant("2026-11-10", "10:40"));
    const tp = tanjongPagar!.platforms[0].directions.find((d) => d.key === "TO_EAST")!;
    expect(tp.seenToday[0]).toMatchObject({ how: "passed", from: "EW16" });
  });
});

describe("v2.1 review follow-up (server)", () => {
  const D = "2026-11-12";
  const T2 = (clock: string) => new Date(sgtInstant(D, clock)).toISOString();
  const ms = (clock: string) => sgtInstant(D, clock);

  it("stores the tap error: Now ±0.5, moved back with the chips ±1 (or late without a hint)", async () => {
    const now = await logTripEvent(USER, { clientId: uuid(21), kind: "board", at: T2("08:00"), station: "EW17", direction: "TO_EAST", timeSource: "now" }, "owner", ms("08:00") + 3_000);
    const chosen = await logTripEvent(USER, { clientId: uuid(22), kind: "board", at: T2("08:30"), station: "EW17", direction: "TO_EAST", timeSource: "chosen" }, "owner", ms("08:31"));
    const late = await logTripEvent(USER, { clientId: uuid(23), kind: "board", at: T2("09:00"), station: "EW17", direction: "TO_EAST" }, "owner", ms("09:05"));
    const err = async (id: number | null) => (await db.select().from(schema.trainSighting).where(eq(schema.trainSighting.id, id!)))[0].errorMin;
    expect(await err(now.sightingId)).toBe(0.5);
    expect(await err(chosen.sightingId)).toBe(1);
    expect(await err(late.sightingId)).toBe(1);
  });

  it("'Got off' inherits the direction of the boarding before it", async () => {
    await logTripEvent(USER, { clientId: uuid(31), kind: "board", at: T2("10:14"), station: "EW17", direction: "TO_EAST" }, "owner", ms("10:14"));
    const off = await logTripEvent(USER, { clientId: uuid(32), kind: "alight", at: T2("10:17"), station: "EW16", direction: "TO_WEST" }, "owner", ms("10:17"));
    const [ev] = await db.select().from(schema.tripEvent).where(eq(schema.tripEvent.id, off.id!));
    expect(ev.direction).toBe("TO_EAST");
    const [s] = await db.select().from(schema.trainSighting).where(eq(schema.trainSighting.id, off.sightingId!));
    expect(s.direction).toBe("TO_EAST");
    // A different line keeps its own direction.
    const tel = await logTripEvent(USER, { clientId: uuid(33), kind: "alight", at: T2("10:25"), station: "TE19", direction: "TO_BAYSHORE" }, "owner", ms("10:25"));
    expect((await db.select().from(schema.tripEvent).where(eq(schema.tripEvent.id, tel.id!)))[0].direction).toBe("TO_BAYSHORE");
  });

  it("scores a boarding from the prediction taken before it was written; back-dated or edited ones are not scored", async () => {
    const fresh = await logTripEvent(USER, { clientId: uuid(41), kind: "board", at: T2("12:00"), station: "EW15", direction: "TO_WEST" }, "owner", ms("12:00") + 5_000);
    const checks = async (id: number | null) => db.select().from(schema.predictionCheck).where(eq(schema.predictionCheck.tripEventId, id!));
    const [check] = await checks(fresh.id);
    expect(check).toBeDefined();
    // The snapshot could not see the boarding itself (no same-day train here before it).
    expect(check.basis).not.toBe("same_day");
    const backdated = await logTripEvent(USER, { clientId: uuid(42), kind: "board", at: T2("12:30"), station: "EW15", direction: "TO_WEST" }, "owner", ms("12:36"));
    expect(await checks(backdated.id)).toEqual([]);
    // Editing a boarding removes its score and marks the sighting edited.
    await updateTripEvent(USER, { id: fresh.id!, at: T2("12:01") });
    expect(await checks(fresh.id)).toEqual([]);
    const [s] = await db.select().from(schema.trainSighting).where(eq(schema.trainSighting.tripEventId, fresh.id!));
    expect(s.editedAt).not.toBeNull();
    expect(new Date(s.at).toISOString()).toBe(T2("12:01"));
    expect(s.errorMin).toBe(1);
  });

  it("two public networks agreeing within 1 min approve each other; one network alone can't", async () => {
    const now = ms("14:05");
    const a = await savePublicSighting({ station: "NS13", direction: "TO_JURONG_EAST", kind: "boarded", at: T2("14:00") }, { deviceId: "dev-aaaa1", ipHash: "net-a", now });
    const a2 = await savePublicSighting({ station: "NS13", direction: "TO_JURONG_EAST", kind: "boarded", at: T2("14:00") }, { deviceId: "dev-aaaa2", ipHash: "net-a", now });
    expect([a.ok && a.status, a2.ok && a2.status]).toEqual(["pending", "pending"]);
    const b = await savePublicSighting({ station: "NS13", direction: "TO_JURONG_EAST", kind: "boarded", at: new Date(ms("14:00") + 30_000).toISOString() }, { deviceId: "dev-bbbb1", ipHash: "net-b", now });
    expect(b).toMatchObject({ ok: true, status: "approved" });
    const rows = await db.select().from(schema.trainSighting).where(eq(schema.trainSighting.station, "NS13"));
    expect(rows.every((r) => r.status === "approved")).toBe(true);
    // Agreed public taps now pass along the line.
    const board = await stationBoard("khatib", now + 5 * 60_000);
    const dir = board!.platforms[0].directions.find((d) => d.key === "TO_JURONG_EAST")!;
    expect(dir.seenToday.some((t) => t.how === "passed")).toBe(true);
  });

  it("the old Hermes ingest body (readings + trip events, no new fields) still succeeds", async () => {
    const saved = { token: process.env.INGEST_TOKEN, emails: process.env.ALLOWED_EMAILS };
    process.env.INGEST_TOKEN = "test-token";
    process.env.ALLOWED_EMAILS = "owner@example.test";
    try {
      const { POST } = await import("@/app/api/ingest/route");
      const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
      const body = {
        readings: [{ station: "TE17", direction: "TO_BAYSHORE", minutes: [3, 9], capturedAt: ago(40) }],
        tripEvents: [
          { clientId: uuid(61), kind: "board", at: ago(37), station: "TE17", line: "TEL", direction: "TO_BAYSHORE" },
          { clientId: uuid(62), kind: "alight", at: ago(34), station: "TE19", line: "TEL", direction: "TO_BAYSHORE" },
        ],
      };
      const res = await POST(new Request("http://x/api/ingest", { method: "POST", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(res.status).toBe(201);
      const json = (await res.json()) as { readings: { ok: boolean }[]; tripEvents: { ok: boolean; sightingId: number | null }[] };
      expect(json.readings.every((r) => r.ok)).toBe(true);
      expect(json.tripEvents.every((r) => r.ok && r.sightingId != null)).toBe(true);
      const hermes = await db.select().from(schema.trainSighting).where(eq(schema.trainSighting.source, "hermes"));
      expect(hermes).toHaveLength(2);
      // Logged long after the fact: ±1 min, and never scored.
      expect(hermes.every((h) => h.errorMin === 1)).toBe(true);
    } finally {
      process.env.INGEST_TOKEN = saved.token;
      process.env.ALLOWED_EMAILS = saved.emails;
      if (saved.token === undefined) delete process.env.INGEST_TOKEN;
      if (saved.emails === undefined) delete process.env.ALLOWED_EMAILS;
    }
  });
});
