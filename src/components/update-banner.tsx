"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { currentBuild, updateAvailable, versionLabel } from "@/lib/build-info";
import { useI18n } from "./i18n";

const CHECK_EVERY_MS = 5 * 60_000;

/** Ask /api/version on open, on visibilitychange and every 5 min; offer a reload. */
export function UpdateBanner() {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const local = currentBuild().buildId;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const remote = (await response.json()) as { buildId?: unknown };
        if (!stopped && updateAvailable(local, remote.buildId)) {
          setReady(true);
          void navigator.serviceWorker?.getRegistration("/").then((r) => r?.update()).catch(() => {});
        }
      } catch {
        /* Offline: try again later. */
      }
    };
    const first = setTimeout(() => void check(), 0);
    const interval = setInterval(() => void check(), CHECK_EVERY_MS);
    const visible = () => void check();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  if (!ready) return null;
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-led px-4 py-2 text-sm font-semibold text-black"
      aria-live="polite"
    >
      <RefreshCw size={15} aria-hidden /> {t("update.available")}
    </button>
  );
}

/** "v1.0.0 · abc1234 · 26 Oct 16:05 SGT" in small print. */
export function VersionTag({ className = "" }: { className?: string }) {
  return <small className={`tabular text-xs text-muted ${className}`}>{versionLabel(currentBuild())}</small>;
}
