"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
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

/**
 * Tabs with a clear current state (aria-current + filled pill).
 * "scroll" rows stay swipeable but hide the scrollbar and keep edge padding.
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
  const active = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (layout === "scroll") active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [layout, pathname]);

  const pill = (on: boolean) =>
    on ? "border-led bg-led font-semibold text-black" : "border-line text-muted hover:border-muted hover:text-ink";
  const row =
    layout === "inline"
      ? "items-center gap-1"
      : layout === "scroll"
        ? "no-scrollbar -mx-4 gap-2 overflow-x-auto px-4 pb-2.5"
        : "flex-wrap gap-2";
  return (
    <nav aria-label={label} className={`flex text-sm ${row} ${className}`}>
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
