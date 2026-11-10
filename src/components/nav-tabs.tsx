"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { splitLocale } from "@/lib/i18n";

export type NavTab = { href: string; label: string; exact?: boolean };

/** Is `href` the current page? Hash links ("/#stations") never are. */
export function isActiveTab(pathname: string, href: string, exact = false) {
  if (href.includes("#")) return false;
  const path = splitLocale(pathname).path.replace(/\/+$/, "") || "/";
  const target = splitLocale(href).path.replace(/\/+$/, "") || "/";
  if (exact || target === "/") return path === target;
  return path === target || path.startsWith(`${target}/`);
}

export type FadeEdges = "none" | "left" | "right" | "both";

/** Which edges of a scrolling row hide tabs (and so fade out): more to the left / right. */
export function fadeEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): FadeEdges {
  const left = scrollLeft > 2;
  const right = scrollLeft + clientWidth < scrollWidth - 2;
  return left && right ? "both" : left ? "left" : right ? "right" : "none";
}

/** scrollLeft that centres a tab in its row (clamped to the row). */
export function centredScroll(tabLeft: number, tabWidth: number, clientWidth: number, scrollWidth: number): number {
  const want = tabLeft - (clientWidth - tabWidth) / 2;
  return Math.max(0, Math.min(scrollWidth - clientWidth, Math.round(want)));
}

/**
 * Tabs with a clear current state (aria-current + filled pill).
 * "scroll" rows (phones) stay swipeable without a scrollbar; an edge fades
 * out wherever more tabs are hidden (v2.2: no clipped tab without a hint),
 * and the current tab is scrolled to the middle of the row.
 */
export function NavTabs({
  tabs,
  label,
  layout,
  className = "",
}: {
  tabs: NavTab[];
  label: string;
  layout: "inline" | "scroll" | "wrap";
  className?: string;
}) {
  const pathname = usePathname() || "/";
  const row = useRef<HTMLElement>(null);
  const active = useRef<HTMLAnchorElement>(null);
  // Before measuring (first paint), assume a long row overflows to the right.
  const [fade, setFade] = useState<FadeEdges>(layout === "scroll" && tabs.length > 4 ? "right" : "none");
  const measure = useCallback(() => {
    const el = row.current;
    if (el) setFade(fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth));
  }, []);

  useEffect(() => {
    if (layout !== "scroll") return;
    const el = row.current;
    const tab = active.current;
    // Only the row scrolls (never the page): centre the current tab.
    if (el && tab) {
      const left = tab.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      el.scrollLeft = centredScroll(left, tab.offsetWidth, el.clientWidth, el.scrollWidth);
    }
    const id = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", measure);
    };
  }, [layout, pathname, measure]);

  const pill = (on: boolean) =>
    on ? "border-led bg-led font-semibold text-black" : "border-line text-muted hover:border-muted hover:text-ink";
  const rowClass =
    layout === "inline"
      ? "items-center gap-1"
      : layout === "scroll"
        ? "no-scrollbar nav-fade -mx-4 gap-2 overflow-x-auto px-4 pb-2.5"
        : "flex-wrap gap-2";
  return (
    <nav
      ref={row}
      aria-label={label}
      data-fade={layout === "scroll" ? fade : undefined}
      onScroll={layout === "scroll" ? measure : undefined}
      className={`flex text-sm ${rowClass} ${className}`}
    >
      {tabs.map((tab) => {
        const on = isActiveTab(pathname, tab.href, tab.exact);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            ref={on ? active : undefined}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-full border px-3 py-1 whitespace-nowrap transition-colors ${pill(on)}`}
          >
            {tab.label}
          </Link>
        );
      })}
      {/* Trailing spacer: the last tab never touches the screen edge. */}
      {layout === "scroll" && <span aria-hidden className="w-1 shrink-0" />}
    </nav>
  );
}
