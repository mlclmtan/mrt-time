/**
 * LTA DataMall (free, LTA_ACCOUNT_KEY): Train Service Alerts and Station
 * Crowd Density Real Time. Cached ~90 s; returns null when the key is unset
 * or rejected so the UI simply hides alerts/crowd chips.
 */
const BASE = "https://datamall2.mytransport.sg/ltaodataservice";
const TTL_MS = 90_000;

export type AlertSegment = { line: string; direction: string; stations: string[] };
export type LineAlerts = {
  status: 1 | 2;
  segments: AlertSegment[];
  messages: { content: string; createdDate: string }[];
};
export type CrowdLevel = "l" | "m" | "h" | "NA";

type Raw = Record<string, unknown>;

/** Parse the TrainServiceAlerts response (`value` is an object, not an array). */
export function parseAlerts(body: unknown): LineAlerts | null {
  const value = (body as { value?: Raw })?.value;
  if (!value || typeof value !== "object") return null;
  const status = Number(value.Status) === 2 ? 2 : 1;
  const segments = (Array.isArray(value.AffectedSegments) ? value.AffectedSegments : [])
    .map((s: Raw) => ({
      line: String(s.Line ?? ""),
      direction: String(s.Direction ?? ""),
      stations: String(s.Stations ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    }))
    // After recovery LTA may keep segments with empty station lists.
    .filter((s: AlertSegment) => s.line && s.stations.length);
  const messages = (Array.isArray(value.Message) ? value.Message : [])
    .map((m: Raw) => ({ content: String(m.Content ?? "").slice(0, 500), createdDate: String(m.CreatedDate ?? "") }))
    .filter((m: { content: string }) => m.content);
  return { status, segments, messages };
}

export function parseCrowd(body: unknown): Record<string, CrowdLevel> {
  const rows = (body as { value?: Raw[] })?.value;
  const out: Record<string, CrowdLevel> = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const level = String(r.CrowdLevel ?? "NA");
    if (typeof r.Station === "string") out[r.Station] = (["l", "m", "h"].includes(level) ? level : "NA") as CrowdLevel;
  }
  return out;
}

/** Lines with an active alert, for banners and push. */
export function affectedLines(alerts: LineAlerts | null): string[] {
  if (!alerts) return [];
  return [...new Set(alerts.segments.map((s) => s.line))];
}

const cache = new Map<string, { at: number; value: unknown }>();
async function cachedGet(path: string, fetchImpl: typeof fetch = fetch): Promise<unknown | null> {
  const key = process.env.LTA_ACCOUNT_KEY?.trim();
  if (!key) return null;
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const res = await fetchImpl(`${BASE}/${path}`, {
      headers: { AccountKey: key, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      cache.set(path, { at: Date.now(), value: null });
      return null;
    }
    const value = await res.json();
    cache.set(path, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

export async function lineAlerts(fetchImpl?: typeof fetch): Promise<LineAlerts | null> {
  const body = await cachedGet("TrainServiceAlerts", fetchImpl);
  return body ? parseAlerts(body) : null;
}

const CROWD_LINE: Record<string, string> = { EW: "EWL", TE: "TEL", NE: "NEL" };

export async function crowdForStations(codes: string[], fetchImpl?: typeof fetch): Promise<Record<string, CrowdLevel> | null> {
  if (!process.env.LTA_ACCOUNT_KEY?.trim()) return null;
  const lines = [...new Set(codes.map((c) => CROWD_LINE[c.slice(0, 2)]).filter(Boolean))];
  const out: Record<string, CrowdLevel> = {};
  for (const line of lines) {
    const body = await cachedGet(`PCDRealTime?TrainLine=${line}`, fetchImpl);
    const levels = body ? parseCrowd(body) : {};
    for (const code of codes) if (levels[code]) out[code] = levels[code];
  }
  return out;
}
