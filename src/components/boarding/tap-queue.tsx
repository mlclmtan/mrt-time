"use client";
import { useCallback, useEffect, useState } from "react";
import { enqueueTap, flushTaps, queuedTaps } from "@/lib/sightings/queue";
import { useAnalytics } from "../analytics/analytics-provider";

/**
 * Offline taps: `enqueue` keeps a tap (with its own time) on the device;
 * the queue is sent when the page opens and whenever the device comes back
 * online. `onSent` runs after something was delivered (refresh views).
 */
export function useTapQueue(onSent?: (n: number) => void) {
  const [waiting, setWaiting] = useState(0);
  const { track } = useAnalytics();

  const flush = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine) return;
    const result = await flushTaps(
      localStorage,
      (u, i) => fetch(u, i),
      Date.now(),
      (evt) => track("tap_queue", evt),
    ).catch(() => null);
    if (!result) {
      const items = queuedTaps(localStorage);
      const oldest = items[0];
      const oldest_age_s = oldest ? Math.max(0, Math.round((Date.now() - oldest.queuedAt) / 1000)) : 0;
      track("tap_queue", { action: "failed", count: items.length, oldest_age_s });
      return;
    }
    setWaiting(result.left);
    if (result.sent > 0) onSent?.(result.sent);
  }, [onSent, track]);

  useEffect(() => {
    const first = setTimeout(() => {
      setWaiting(queuedTaps(localStorage).length);
      void flush();
    }, 0);
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => {
      clearTimeout(first);
      window.removeEventListener("online", online);
    };
  }, [flush]);

  const enqueue = useCallback(
    (url: string, body: unknown, headers?: Record<string, string>) => {
      enqueueTap(localStorage, { url, body, ...(headers ? { headers } : {}) });
      const items = queuedTaps(localStorage);
      setWaiting(items.length);
      const oldest = items[0];
      const oldest_age_s = oldest ? Math.max(0, Math.round((Date.now() - oldest.queuedAt) / 1000)) : 0;
      track("tap_queue", { action: "queued", count: items.length, oldest_age_s });
    },
    [track],
  );

  return { enqueue, waiting, flush };
}
