import { currentBuild, versionLabel, type BuildInfo } from "@/lib/build-info";

/**
 * Small build footer for Home and Settings, high enough on the page to be
 * seen without scrolling far: "v1.1.0 · abc1234 · 3 Nov 20:15 SGT".
 */
export function VersionFooter({ build = currentBuild(), className = "" }: { build?: BuildInfo; className?: string }) {
  return (
    <footer className={`tabular text-[11px] text-muted ${className}`} aria-label="Version">
      <small>{versionLabel(build)}</small>
    </footer>
  );
}
