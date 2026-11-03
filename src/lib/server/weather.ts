/**
 * data.gov.sg 2-hour forecast (free; an optional DATA_GOV_SG_API_KEY raises
 * rate limits). Cached 10 min.
 */
const URL_2H = "https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast";
const TTL_MS = 10 * 60_000;

export type AreaForecast = Record<string, string>;

export function parseTwoHour(body: unknown): AreaForecast {
  const items = (body as { data?: { items?: { forecasts?: { area?: string; forecast?: string }[] }[] } })?.data?.items;
  const latest = Array.isArray(items) ? items[items.length - 1] : null;
  const out: AreaForecast = {};
  for (const f of latest?.forecasts ?? []) if (f.area && f.forecast) out[f.area] = f.forecast;
  return out;
}

let cache: { at: number; value: AreaForecast } | null = null;
export async function twoHourForecast(fetchImpl: typeof fetch = fetch): Promise<AreaForecast | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const key = process.env.DATA_GOV_SG_API_KEY?.trim();
    const res = await fetchImpl(URL_2H, {
      headers: key ? { "x-api-key": key } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const value = parseTwoHour(await res.json());
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}
