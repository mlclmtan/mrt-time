/**
 * /api/predict and /api/board must never read whole tables. A recording
 * stand-in for the Neon HTTP client captures every SQL string.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";

const recorded: string[] = [];
const client = async (query: string) => {
  recorded.push(query);
  return { rows: [], fields: [], rowCount: 0, command: "SELECT", rowAsArray: true };
};
const db = drizzle(client as never, { schema });

vi.mock("../db", async (original) => ({
  ...(await original<typeof import("../db")>()),
  getDb: () => db,
}));

const { observationStore, clearWindowsCache } = await import("./observations");

const savedUrl = process.env.DATABASE_URL;
beforeEach(() => {
  recorded.length = 0;
  clearWindowsCache();
  process.env.DATABASE_URL = "postgres://recording-only";
});
afterAll(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

/** A read of a big table without a keyed WHERE clause is a full-table read. */
function fullTableReads(queries: string[]) {
  return queries.filter(
    (q) =>
      /from "(observation|event_log|trip_event|prediction_check)"/.test(q) &&
      !/ where .*"(station|line)" (in|=)/i.test(q),
  );
}

describe("observation queries", () => {
  it("are keyed by platform codes or lines and bounded in time", async () => {
    const store = observationStore(db);
    await store.forPlatforms(["EW16", "TE17"], Date.now());
    await store.forLines(["EWL"], Date.now());
    await store.near("EW17", "EWL", "TO_EAST", Date.now(), 30 * 60_000);
    expect(recorded[0]).toMatch(/where \("observation"\."station" in \(\$1, \$2\) and "observation"\."status" = \$3 and "observation"\."captured_at" >= \$4\)/);
    expect(recorded[0]).toMatch(/limit \$5/);
    expect(recorded[1]).toMatch(/"observation"\."line" in \(\$1\)/);
    expect(recorded[2]).toMatch(/"observation"\."station" = \$1 and "observation"\."line" = \$2/);
    expect(fullTableReads(recorded)).toEqual([]);
  });
});

describe("request paths", () => {
  it("/api/predict queries one platform and its line only", async () => {
    const { GET } = await import("@/app/api/predict/route");
    const res = await GET(new Request("http://x/api/predict?station=EW17&direction=TO_EAST"));
    expect(res.status).toBe(200);
    const observationReads = recorded.filter((q) => /from "observation"/.test(q));
    expect(observationReads).toHaveLength(2);
    expect(fullTableReads(recorded)).toEqual([]);
    const body = (await res.json()) as { prediction: { kind: string } };
    expect(["times", "range", "closed"]).toContain(body.prediction.kind);
  });

  it("/api/board queries the station's platforms and lines only", async () => {
    const { GET } = await import("@/app/api/board/route");
    const res = await GET(new Request("http://x/api/board?station=outram-park"));
    expect(res.status).toBe(200);
    expect(recorded.some((q) => /"observation"\."station" in \(\$1, \$2, \$3\)/.test(q))).toBe(true);
    expect(fullTableReads(recorded)).toEqual([]);
    const body = (await res.json()) as { board: { platforms: unknown[] } };
    expect(body.board.platforms).toHaveLength(3);
  });

  it("rejects unknown stations without touching the database", async () => {
    const { GET } = await import("@/app/api/board/route");
    expect((await GET(new Request("http://x/api/board?station=nope"))).status).toBe(404);
    expect(recorded).toEqual([]);
  });
});
