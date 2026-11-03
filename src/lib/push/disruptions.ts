/** Disruption alerts for saved journeys (pure part). */
import { fnv1a } from "../analytics/experiments";
import type { LineAlerts } from "../server/lta";
import type { PushMessage } from "./send";

export const BUS_APP_URL = "https://bus.91208274.xyz";

export function disruptionMessage(alerts: LineAlerts | null, journeyLines: string[]): { hash: string; message: PushMessage } | null {
  if (!alerts) return null;
  const hits = alerts.segments.filter((s) => journeyLines.includes(s.line));
  if (!hits.length) return null;
  const lines = [...new Set(hits.map((s) => s.line))].sort();
  const stations = [...new Set(hits.flatMap((s) => s.stations))];
  const hash = fnv1a(JSON.stringify({ lines, stations, status: alerts.status })).toString(36);
  const first = alerts.messages[0]?.content;
  return {
    hash,
    message: {
      title: `${lines.join(" & ")} ${alerts.status === 2 ? "disruption" : "delay"}`,
      body: (first || `Affected: ${stations.slice(0, 6).join(", ")}`).slice(0, 180) + " — buses: bus.91208274.xyz",
      tag: `mrt:alert:${lines.join("-")}`,
      url: "/",
    },
  };
}
