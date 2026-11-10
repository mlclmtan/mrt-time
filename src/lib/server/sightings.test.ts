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
    expect(second.written).toBe(1);
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
    expect((await loadSightings(["EWL"], now)).every((s) => s.status === "approved")).toBe(true);
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
