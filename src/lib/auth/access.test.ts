import { describe, expect, it } from "vitest";
import { devBypassAllowed, emailPermitted, roleFor } from "./access";

describe("access", () => {
  it("owners and analysts come from separate allowlists; empty lists fail closed", () => {
    const env = { ALLOWED_EMAILS: "Owner@Example.com, other@example.com", ANALYST_EMAILS: "analyst@example.com" };
    expect(roleFor("owner@example.com", env)).toBe("owner");
    expect(roleFor("analyst@example.com", env)).toBe("analyst");
    expect(roleFor("stranger@example.com", env)).toBeNull();
    expect(roleFor("owner@example.com", {})).toBeNull();
    expect(emailPermitted("", "a@b.c")).toBe(false);
  });

  it("dev bypass needs NODE_ENV=development and refuses on Vercel or with a database", () => {
    const base = { NODE_ENV: "development", MRT_DEV_BYPASS: "1" };
    expect(devBypassAllowed(base)).toBe(true);
    expect(devBypassAllowed({ ...base, NODE_ENV: "production" })).toBe(false);
    expect(devBypassAllowed({ ...base, VERCEL: "1" })).toBe(false);
    expect(devBypassAllowed({ ...base, VERCEL_ENV: "preview" })).toBe(false);
    expect(devBypassAllowed({ ...base, DATABASE_URL: "postgres://x" })).toBe(false);
    expect(devBypassAllowed({ NODE_ENV: "development" })).toBe(false);
  });
});
