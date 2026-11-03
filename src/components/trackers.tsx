"use client";
import { useEffect, useRef } from "react";
import { useAnalytics } from "./analytics/analytics-provider";

/** experiment_exposure once per mount. */
export function ExposureTracker({ experiment, variant }: { experiment: string; variant: string }) {
  const { track, consent } = useAnalytics();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !(consent.analytics || consent.marketing)) return;
    sent.current = true;
    track("experiment_exposure", { experiment_id: experiment, variant });
  }, [experiment, variant, track, consent.analytics, consent.marketing]);
  return null;
}

/** kol_landing once per mount. */
export function KolTracker({ handle, codeUsed }: { handle: string; codeUsed: boolean }) {
  const { track, consent } = useAnalytics();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !(consent.analytics || consent.marketing)) return;
    sent.current = true;
    track("kol_landing", { kol_handle: handle, code_used: codeUsed });
  }, [handle, codeUsed, track, consent.analytics, consent.marketing]);
  return null;
}

/** station_view once per mount. */
export function StationTracker({ station, line }: { station: string; line?: "EWL" | "TEL" | "NEL" }) {
  const { track, consent } = useAnalytics();
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || !(consent.analytics || consent.marketing)) return;
    sent.current = true;
    track("station_view", { station, ...(line ? { line } : {}) });
  }, [station, line, track, consent.analytics, consent.marketing]);
  return null;
}
