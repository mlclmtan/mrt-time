"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export function AppMain({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pathname]);

  return (
    <main
      ref={mainRef}
      id="main-scroll"
      className="flex flex-1 min-h-0 flex-col overflow-y-auto overscroll-y-contain px-4 [-webkit-overflow-scrolling:touch]"
    >
      {children}
    </main>
  );
}
