"use client";
import { useEffect, useRef } from "react";
import { useAnalytics } from "../analytics/analytics-provider";

/** stats_view once per mount. */
export function StatsTracker({ trips }: { trips: number }) {
  const { track, consent } = useAnalytics();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !(consent.analytics || consent.marketing)) return;
    sent.current = true;
    track("stats_view", { trips });
  }, [trips, track, consent.analytics, consent.marketing]);
  return null;
}
