/** Live board for a station / one platform direction (shared by API + pages). */
import { getLine, getPlatform, getStation, inService, LINES, type LineCode } from "../network";
import { predict, type Prediction } from "../predict";
import { getUnstableWindows, loadObservations } from "./observations";

export type BoardDirection = {
  key: string;
  label: { en: string; "zh-Hant": string };
  terminal: string;
  prediction: Prediction;
};
export type BoardPlatform = {
  code: string;
  line: LineCode;
  lineName: { en: string; "zh-Hant": string };
  color: string;
  inService: boolean;
  directions: BoardDirection[];
};
export type Board = { station: string; now: number; platforms: BoardPlatform[] };

export async function stationBoard(slug: string, now = Date.now()): Promise<Board | null> {
  const station = getStation(slug);
  if (!station) return null;
  const lines = [...new Set(station.codes.map((c) => getPlatform(c)!.line))];
  const [observations, windows] = await Promise.all([
    loadObservations(station.codes, lines, now),
    getUnstableWindows(now),
  ]);
  return {
    station: slug,
    now,
    platforms: station.codes.map((code) => {
      const line = LINES[getPlatform(code)!.line];
      return {
        code,
        line: line.code,
        lineName: line.name,
        color: line.color,
        inService: inService(line, now),
        directions: Object.values(line.directions)
          // A terminal platform only has trains leaving one way.
          .filter((d) => d.terminal !== code)
          .map((d) => ({
            key: d.key,
            label: d.label,
            terminal: d.terminal,
            prediction: predict({ line: line.code, direction: d.key, station: code, now, observations, unstableWindows: windows }),
          })),
      };
    }),
  };
}

export async function platformPrediction(code: string, direction: string, now = Date.now()) {
  const platform = getPlatform(code);
  if (!platform || !getLine(platform.line)?.directions[direction]) return null;
  const [observations, windows] = await Promise.all([
    loadObservations([code], [platform.line], now),
    getUnstableWindows(now),
  ]);
  return predict({ line: platform.line, direction, station: code, now, observations, unstableWindows: windows });
}
