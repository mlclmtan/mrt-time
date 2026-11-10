/** /accuracy: predictions replayed against real boardings (train sightings). */
import { dbConfigured, getDb } from "../db";
import { LINE_CODES } from "../network";
import { backtestSightings, type BacktestRow } from "../predict/accuracy";
import { median } from "../time";
import { getWindowSettings, observationStore } from "./observations";
import { sightingStore } from "./sightings";

export type AccuracyGroup = { key: string; scored: number; hits: number; ranges: number; medianErrorMin: number | null };

export function groupBacktest(rows: BacktestRow[], by: "line" | "band" | "station"): AccuracyGroup[] {
  const groups = new Map<string, BacktestRow[]>();
  for (const r of rows) groups.set(r[by], [...(groups.get(r[by]) ?? []), r]);
  return [...groups.entries()]
    .map(([key, list]) => {
      const scored = list.filter((r) => r.hit != null);
      return {
        key,
        scored: scored.length,
        hits: scored.filter((r) => r.hit).length,
        ranges: list.length - scored.length,
        medianErrorMin: median(scored.map((r) => Math.abs(r.errorMin ?? 0))),
      };
    })
    .sort((a, b) => b.scored - a.scored || a.key.localeCompare(b.key));
}

export async function sightingAccuracy(now = Date.now()): Promise<BacktestRow[]> {
  if (!dbConfigured()) return [];
  const db = getDb();
  const [sightings, observations, settings] = await Promise.all([
    sightingStore(db).forLines(LINE_CODES, now),
    observationStore(db).forLines(LINE_CODES, now),
    getWindowSettings(now),
  ]);
  return backtestSightings(sightings, observations, { unstableWindows: settings.windows, windowsCustom: settings.custom });
}
