"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAnalytics } from "./analytics-provider";
import {
  addBreadcrumb,
  checkAndArmExitState,
  initLongTaskObserver,
  installFetchBreadcrumbTracker,
  installGlobalErrorHandlers,
  resetPageErrors,
} from "@/lib/analytics/health";
import { cleanRoute } from "@/lib/analytics/events";

export function HealthMonitor() {
  const { track } = useAnalytics();
  const pathname = usePathname();

  useEffect(() => {
    const unErrors = installGlobalErrorHandlers();
    const unExit = checkAndArmExitState((data) => track("unclean_exit", data));
    const unTasks = initLongTaskObserver((data) => track("long_tasks", data));
    const unFetch = installFetchBreadcrumbTracker();

    return () => {
      unErrors();
      unExit();
      unTasks();
      unFetch();
    };
  }, [track]);

  useEffect(() => {
    resetPageErrors();
    const clean = cleanRoute(pathname || "/");
    addBreadcrumb(`route:${clean}`);
  }, [pathname]);

  return null;
}
