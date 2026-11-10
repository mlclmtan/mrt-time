/** Live board for a station / one platform direction (shared by API + pages). */
import { directionsAt, getLine, getPlatform, getStation, inService, LINES, type LineCode } from "../network";
import { platformTrains, predict, type Observation, type Prediction, type TrainSighting } from "../predict";
import { sgtDate } from "../time";
import { getWindowSettings, loadObservations, type WindowSettings } from "./observations";
import { loadSightings } from "./sightings";

/** One train seen today at this platform: when, and how we know. */
export type SeenTrain = {
  at: number;
  /** boarded = someone got on/off here; reading = shown on this board; passed = seen at another station. */
  how: "boarded" | "reading" | "passed";
  /** Platform where it was seen, for "passed". */
  from?: string;
  spreadMin: number;
};

export type BoardDirection = {
  key: string;
  label: { en: string; "zh-Hant": string };
  /** Destination as the platform board shows it ("Pasir Ris"). */
  board: { en: string; "zh-Hant": string };
  terminal: string;
  prediction: Prediction;
  /** Trains seen at this platform today, newest first. */
  seenToday: SeenTrain[];
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

export const SEEN_TODAY_MAX = 12;

/** Trains known at a platform today that have already come (not future propagated ones). */
export function seenToday(input: { station: string; line: string; direction: string; observations: Observation[]; sightings: TrainSighting[] }, now: number): SeenTrain[] {
  const today = sgtDate(now);
  return platformTrains(input)
    .filter((t) => sgtDate(t.at) === today && t.at <= now && t.seenAt <= now)
    .sort((a, b) => b.at - a.at)
    .slice(0, SEEN_TODAY_MAX)
    .map((t) => ({
      at: t.at,
      how: t.hops > 0 ? ("passed" as const) : t.kind === "board_reading" ? ("reading" as const) : ("boarded" as const),
      ...(t.hops > 0 ? { from: t.origin } : {}),
      spreadMin: t.spreadMin,
    }));
}

type Data = { observations: Observation[]; sightings: TrainSighting[]; settings: WindowSettings };

async function loadFor(codes: string[], lines: string[], now: number): Promise<Data> {
  const [observations, sightings, settings] = await Promise.all([loadObservations(codes, lines, now), loadSightings(lines, now), getWindowSettings(now)]);
  return { observations, sightings, settings };
}

function predictWith(data: Data, line: string, direction: string, station: string, now: number) {
  return predict({
    line,
    direction,
    station,
    now,
    observations: data.observations,
    sightings: data.sightings,
    unstableWindows: data.settings.windows,
    windowsCustom: data.settings.custom,
  });
}

export async function stationBoard(slug: string, now = Date.now()): Promise<Board | null> {
  const station = getStation(slug);
  if (!station) return null;
  const lines = [...new Set(station.codes.map((c) => getPlatform(c)!.line))];
  const data = await loadFor(station.codes, lines, now);
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
        // A terminal platform only has trains leaving one way.
        directions: directionsAt(code).map((d) => ({
          key: d.key,
          label: d.label,
          board: d.board,
          terminal: d.terminal,
          prediction: predictWith(data, line.code, d.key, code, now),
          seenToday: seenToday({ station: code, line: line.code, direction: d.key, observations: data.observations, sightings: data.sightings }, now),
        })),
      };
    }),
  };
}

/** Prediction for one platform direction. `excludeTripEventId` leaves out a boarding being scored. */
export async function platformPrediction(code: string, direction: string, now = Date.now(), opts: { excludeTripEventId?: number } = {}) {
  const platform = getPlatform(code);
  if (!platform || !getLine(platform.line)?.directions[direction]) return null;
  const data = await loadFor([code], [platform.line], now);
  if (opts.excludeTripEventId != null) data.sightings = data.sightings.filter((s) => s.tripEventId !== opts.excludeTripEventId);
  // Only what was known before this moment.
  data.sightings = data.sightings.filter((s) => s.at < now);
  data.observations = data.observations.filter((o) => o.capturedAt <= now);
  return predictWith(data, platform.line, direction, code, now);
}

/** Readings + sightings + windows for planning several legs at once. */
export async function predictionData(codes: string[], lines: string[], now: number): Promise<Data> {
  return loadFor(codes, lines, now);
}
