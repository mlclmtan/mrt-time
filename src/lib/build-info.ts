/**
 * Build identity, baked into the bundle by next.config `env` and compared
 * with /api/version to offer "Update available". Pure helpers.
 */
import { sgtClock, sgtDate } from "./time";
export type BuildInfo = {
  version: string;
  sha: string;
  /** ISO instant the build ran. */
  builtAt: string;
  /** Changes with every build (same commit rebuilt → new id). */
  buildId: string;
};
/** SHA from Vercel (VERCEL_GIT_COMMIT_SHA), else `git rev-parse`, else "dev". */
export function resolveBuildInfo({
  version,
  vercelSha,
  gitSha,
  now,
}: {
  version: string;
  vercelSha?: string;
  gitSha: () => string | null;
  now: Date;
}): BuildInfo {
  const clean = (value: string | null | undefined) =>
    value && /^[0-9a-f]{7,40}$/i.test(value.trim())
      ? value.trim().slice(0, 7).toLowerCase()
      : null;
  let sha = clean(vercelSha);
  if (!sha) {
    try {
      sha = clean(gitSha());
    } catch {
      sha = null;
    }
  }
  const resolved = sha ?? "dev";
  return {
    version,
    sha: resolved,
    builtAt: now.toISOString(),
    buildId: `${version}+${resolved}.${now.getTime().toString(36)}`,
  };
}
/** This bundle's build (inlined at build time). */
export function currentBuild(): BuildInfo {
  return {
    version: process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0",
    sha: process.env.NEXT_PUBLIC_BUILD_SHA || "dev",
    builtAt: process.env.NEXT_PUBLIC_BUILT_AT || "",
    buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
  };
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "v1.0.0 · abc1234 · 23 Oct 14:05 SGT" */
export function versionLabel(build: BuildInfo) {
  const at = Date.parse(build.builtAt);
  if (!Number.isFinite(at)) return `v${build.version} · ${build.sha}`;
  const date = new Date(`${sgtDate(at)}T00:00:00Z`);
  return `v${build.version} · ${build.sha} · ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${sgtClock(at)} SGT`;
}
/** Is the server running a different build than this page? */
export function updateAvailable(local: string, remote: unknown) {
  return (
    typeof remote === "string" &&
    /^[\w.+-]{3,80}$/.test(remote) &&
    local !== "dev" &&
    remote !== local
  );
}
