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

export type AreaLocation = { name: string; lat: number; lng: number };
/** Forecast areas with their label points (data.gov.sg `area_metadata`). */
export function parseAreaLocations(body: unknown): AreaLocation[] {
  const meta = (body as { data?: { area_metadata?: { name?: string; label_location?: { latitude?: number; longitude?: number } }[] } })?.data?.area_metadata;
  return (Array.isArray(meta) ? meta : []).flatMap((m) =>
    m.name && typeof m.label_location?.latitude === "number" && typeof m.label_location.longitude === "number"
      ? [{ name: m.name, lat: m.label_location.latitude, lng: m.label_location.longitude }]
      : [],
  );
}
let areaLocations: AreaLocation[] = [];

/** The forecast for a station: its hand-set area, else the nearest forecast area. */
export function forecastFor(
  station: { lat: number; lng: number; weatherArea?: string },
  forecast: AreaForecast,
  areas: AreaLocation[] = areaLocations,
): { area: string; forecast: string } | null {
  if (station.weatherArea && forecast[station.weatherArea]) return { area: station.weatherArea, forecast: forecast[station.weatherArea] };
  let best: AreaLocation | null = null;
  let bestD = Infinity;
  for (const a of areas) {
    if (!forecast[a.name]) continue;
    const d = (a.lat - station.lat) ** 2 + ((a.lng - station.lng) * Math.cos((station.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best ? { area: best.name, forecast: forecast[best.name] } : null;
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
    const body = await res.json();
    const value = parseTwoHour(body);
    const areas = parseAreaLocations(body);
    if (areas.length) areaLocations = areas;
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}
