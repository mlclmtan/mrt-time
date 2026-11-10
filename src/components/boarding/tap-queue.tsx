"use client";
import { useCallback, useEffect, useState } from "react";
import { enqueueTap, flushTaps, queuedTaps } from "@/lib/sightings/queue";

/**
 * Offline taps: `enqueue` keeps a tap (with its own time) on the device;
 * the queue is sent when the page opens and whenever the device comes back
 * online. `onSent` runs after something was delivered (refresh views).
 */
export function useTapQueue(onSent?: (n: number) => void) {
  const [waiting, setWaiting] = useState(0);

  const flush = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine) return;
    const result = await flushTaps(localStorage, (u, i) => fetch(u, i)).catch(() => null);
    if (!result) return;
    setWaiting(result.left);
    if (result.sent) onSent?.(result.sent);
  }, [onSent]);

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

  const enqueue = useCallback((url: string, body: unknown, headers?: Record<string, string>) => {
    enqueueTap(localStorage, { url, body, ...(headers ? { headers } : {}) });
    setWaiting(queuedTaps(localStorage).length);
  }, []);

  return { enqueue, waiting, flush };
}
