import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import * as authServer from "@/lib/auth/server";
import * as dbModule from "@/lib/db";
import * as symptomsModule from "@/lib/analytics/symptoms";

describe("GET /api/admin/symptoms auth", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.INGEST_TOKEN = "secret-token-123";
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
  });

  it("returns 401 when no auth is provided", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValue(null);
    const req = new Request("http://localhost:3000/api/admin/symptoms?since=7d");
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("returns 401 when an invalid bearer token is provided", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValue(null);
    const req = new Request("http://localhost:3000/api/admin/symptoms?since=7d", {
      headers: { authorization: "Bearer wrong-token" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("allows access with valid INGEST_TOKEN bearer token", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValue(null);
    vi.spyOn(dbModule, "dbConfigured").mockReturnValue(true);
    vi.spyOn(dbModule, "getDb").mockReturnValue({ execute: vi.fn() } as unknown as ReturnType<typeof dbModule.getDb>);
    vi.spyOn(symptomsModule, "getSymptomsReport").mockResolvedValue({
      window: { from: "2026-11-11T00:00:00.000Z", to: "2026-11-18T00:00:00.000Z" },
      findings: [],
      counts: { client_error: 0, unclean_exit: 0, tap_queue_failures: 0 },
    });

    const req = new Request("http://localhost:3000/api/admin/symptoms?since=7d", {
      headers: { authorization: "Bearer secret-token-123" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("findings");
    expect(data).toHaveProperty("counts");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("allows access with an owner or analyst session", async () => {
    vi.spyOn(authServer, "getSession").mockResolvedValue({
      user: { id: "u1", email: "owner@example.com", name: "Owner", role: "owner" },
      session: { id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 3600000) },
    } as unknown as NonNullable<Awaited<ReturnType<typeof authServer.getSession>>>);
    vi.spyOn(dbModule, "dbConfigured").mockReturnValue(true);
    vi.spyOn(dbModule, "getDb").mockReturnValue({ execute: vi.fn() } as unknown as ReturnType<typeof dbModule.getDb>);
    vi.spyOn(symptomsModule, "getSymptomsReport").mockResolvedValue({
      window: { from: "2026-11-11T00:00:00.000Z", to: "2026-11-18T00:00:00.000Z" },
      findings: [],
      counts: { client_error: 0, unclean_exit: 0, tap_queue_failures: 0 },
    });

    const req = new Request("http://localhost:3000/api/admin/symptoms?since=7d");
    const res = await GET(req);
    expect(res.status).toBe(200);
  });
});
