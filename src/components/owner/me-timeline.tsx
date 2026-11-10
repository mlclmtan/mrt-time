"use client";
import { useCallback, useState } from "react";
import { TripTimeline, type TimelineItem } from "./trip-timeline";

/** /me: today's timeline that refreshes itself after every edit. */
export function MeTimeline({ initial }: { initial: TimelineItem[] }) {
  const [events, setEvents] = useState(initial);
  const reload = useCallback(async () => {
    const res = await fetch("/api/trip-events", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setEvents(((await res.json()) as { events: TimelineItem[] }).events);
  }, []);
  return <TripTimeline events={events} onChanged={() => void reload()} />;
}
