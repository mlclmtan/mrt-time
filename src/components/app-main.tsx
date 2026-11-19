"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ArrowDown, RefreshCw } from "lucide-react";
import { useI18n } from "./i18n";
import { pullDistance, pullPhase } from "@/lib/pull-refresh";

export function AppMain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const mainRef = useRef<HTMLElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  const phase = pullPhase(pull, refreshing);

  return (
    <main
      ref={mainRef}
      id="main-scroll"
      onTouchStart={(e) => {
        if (refreshing) return;
        startY.current = (mainRef.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null;
      }}
      onTouchMove={(e) => {
        if (startY.current == null) return;
        const d = pullDistance(e.touches[0].clientY - startY.current);
        if (d === 0 && pull > 0) setPull(0);
        else if (d !== pull) setPull(d);
      }}
      onTouchEnd={() => {
        if (startY.current == null) return;
        startY.current = null;
        if (pullPhase(pull, false) === "release") {
          setRefreshing(true);
          window.location.reload();
        } else setPull(0);
      }}
      className="flex flex-1 min-h-0 flex-col overflow-y-auto overscroll-y-contain px-4 [-webkit-overflow-scrolling:touch]"
    >
      <div
        aria-live="polite"
        className="flex shrink-0 items-end justify-center overflow-hidden text-xs text-muted transition-[height] duration-150 motion-reduce:transition-none"
        style={{ height: phase === "refreshing" ? 48 : pull }}
      >
        {phase !== "idle" && (
          <span className="flex items-center gap-1.5 pb-2">
            {phase === "refreshing" ? (
              <RefreshCw size={16} className="animate-spin" aria-hidden />
            ) : (
              <ArrowDown size={16} className={`transition-transform ${phase === "release" ? "rotate-180" : ""}`} aria-hidden />
            )}
            {t(phase === "refreshing" ? "ptr.refreshing" : phase === "release" ? "ptr.release" : "ptr.pull")}
          </span>
        )}
      </div>
      {children}
    </main>
  );
}
