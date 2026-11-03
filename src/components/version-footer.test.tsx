import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveBuildInfo, versionLabel } from "@/lib/build-info";
import { VersionFooter } from "./version-footer";

describe("VersionFooter", () => {
  it("renders v<pkg> · <sha> · <SGT build time>", () => {
    const build = resolveBuildInfo({
      version: "1.1.0",
      vercelSha: "abcdef1234567",
      gitSha: () => null,
      now: new Date("2026-11-03T12:15:00Z"), // 20:15 SGT
    });
    const html = renderToStaticMarkup(<VersionFooter build={build} />);
    expect(versionLabel(build)).toBe("v1.1.0 · abcdef1 · 3 Nov 20:15 SGT");
    expect(html).toContain("v1.1.0 · abcdef1 · 3 Nov 20:15 SGT");
    expect(html).toMatch(/^<footer[^>]*aria-label="Version"/);
  });

  it("falls back to the bundle's build info", () => {
    const html = renderToStaticMarkup(<VersionFooter />);
    expect(html).toMatch(/v\d+\.\d+\.\d+ · [\w]+/);
  });
});
