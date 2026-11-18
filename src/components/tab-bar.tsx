"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrainFront, MapPin, CirclePlus, Route, User, Ellipsis, type LucideIcon } from "lucide-react";
import { isActiveTab } from "./nav-tabs";
import { splitLocale, type DictKey } from "@/lib/i18n";
import { useI18n } from "./i18n";
import { useAnalytics } from "./analytics/analytics-provider";
import { addBreadcrumb } from "@/lib/analytics/health";
import type { Role } from "@/lib/auth/access";

export type TabItem = {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

export function getTabBarTabs(
  role: Role | string | null | undefined,
  t: (key: DictKey) => string,
): TabItem[] {
  if (role === "owner") {
    return [
      { key: "trip", href: "/trip", label: t("tab.trip"), icon: TrainFront },
      { key: "stations", href: "/stations", label: t("tab.stations"), icon: MapPin },
      { key: "log", href: "/add", label: t("tab.log"), icon: CirclePlus },
      { key: "plan", href: "/plan", label: t("tab.plan"), icon: Route },
      { key: "me", href: "/me", label: t("tab.me"), icon: User },
    ];
  }
  return [
    { key: "stations", href: "/stations", label: t("tab.stations"), icon: MapPin },
    { key: "plan", href: "/plan", label: t("tab.plan"), icon: Route },
    { key: "log", href: "/add", label: t("tab.log"), icon: CirclePlus },
    { key: "more", href: "/settings", label: t("tab.more"), icon: Ellipsis },
  ];
}

export function getActiveTabIndex(
  tabs: Array<{ href: string; exact?: boolean }>,
  pathname: string,
): number {
  const direct = tabs.findIndex((tab) => isActiveTab(pathname, tab.href, tab.exact));
  if (direct !== -1) return direct;
  const { path } = splitLocale(pathname);
  if (path.startsWith("/station/")) {
    return tabs.findIndex((tab) => splitLocale(tab.href).path === "/stations");
  }
  if (path === "/" && tabs.some((tab) => splitLocale(tab.href).path === "/trip")) {
    return tabs.findIndex((tab) => splitLocale(tab.href).path === "/trip");
  }
  return -1;
}

export function TabBar({ role }: { role?: Role | string | null }) {
  const pathname = usePathname() || "/";
  const { t, href } = useI18n();
  const { track } = useAnalytics();
  const tabs = getTabBarTabs(role, t);
  const activeIndex = getActiveTabIndex(tabs, pathname);
  const currentTab = activeIndex >= 0 ? tabs[activeIndex]?.key : "other";

  return (
    <nav
      aria-label="Navigation"
      className="site-tab-bar fixed bottom-0 left-0 right-0 z-40 mx-auto w-full max-w-5xl border-t border-line bg-panel"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="relative flex h-14 w-full items-stretch">
        {activeIndex >= 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{
              width: `${100 / tabs.length}%`,
              transform: `translateX(${activeIndex * 100}%)`,
            }}
          >
            <div className="flex h-full w-full flex-col items-center justify-start pt-1.5">
              <div className="h-7 w-12 rounded-full bg-led shadow-sm" />
            </div>
          </div>
        )}
        {tabs.map((tab, idx) => {
          const isActive = idx === activeIndex;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={href(tab.href)}
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                if (currentTab !== tab.key) {
                  track("tab_nav", { from: currentTab, to: tab.key });
                  addBreadcrumb(`tab:${tab.key}`);
                }
              }}
              className="relative z-10 flex min-h-[48px] flex-1 flex-col items-center justify-start pt-1.5 pb-1 text-center"
            >
              <div className="flex h-7 w-12 items-center justify-center">
                <Icon
                  size={24}
                  aria-hidden="true"
                  className={`shrink-0 transition-colors ${
                    isActive ? "text-[#0f1316]" : "text-muted hover:text-ink"
                  }`}
                />
              </div>
              <span
                className={`mt-0.5 text-xs font-medium leading-none tracking-tight transition-colors ${
                  isActive ? "text-ink font-semibold" : "text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
