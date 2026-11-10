/** Owner journeys (from the DB seed) and the planner shared by API + pages. */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, dbConfigured } from "../db";
import { journey, place } from "../db/schema";
import { DIRECTION_KEY_RE, LINE_CODE_LIST, PLATFORM_CODE_RE, findRoutes, getPlatform, getStation, stationForCode } from "../network";
import { planForward, planLeaveBy, planList, routeToLegs, type Leg, type Plan } from "../journey/plan";
import { isRainy, predictionSource } from "../journey/source";
import { commuteView, type CommuteProgress, type CommuteView } from "../journey/commute";
import { predictionData } from "./board";
import { forecastFor, twoHourForecast } from "./weather";
import { affectedLines, lineAlerts } from "./lta";

const code = z.string().regex(PLATFORM_CODE_RE);
export const legSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("walk"), min: z.number().min(0).max(120), label: z.string().max(60).optional(), tip: z.string().max(200).optional() }),
  z.object({
    kind: z.literal("ride"),
    line: z.enum(LINE_CODE_LIST),
    from: code,
    to: code,
    direction: z.string().regex(DIRECTION_KEY_RE),
    rideMin: z.number().min(0).max(120).optional(),
    tip: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal("transfer"), min: z.number().min(0).max(60), at: z.string().max(40).optional(), tip: z.string().max(200).optional() }),
]);
export const legsSchema = z.array(legSchema).min(1).max(12);

export type OwnerJourney = {
  id: number;
  key: string;
  name: string;
  fromPlace: string | null;
  toPlace: string | null;
  legs: Leg[];
  sheltered: boolean;
};

export async function ownerJourneys(userId: string): Promise<OwnerJourney[]> {
  if (!dbConfigured()) return [];
  const rows = await getDb()
    .select()
    .from(journey)
    .where(and(eq(journey.userId, userId), eq(journey.active, true)))
    .orderBy(asc(journey.sort), asc(journey.id));
  return rows.flatMap((r) => {
    const legs = legsSchema.safeParse(r.legs);
    return legs.success
      ? [{ id: r.id, key: r.key, name: r.name, fromPlace: r.fromPlace, toPlace: r.toPlace, legs: legs.data as Leg[], sheltered: r.sheltered }]
      : [];
  });
}

export async function ownerPlaces(userId: string) {
  if (!dbConfigured()) return [];
  return getDb().select().from(place).where(eq(place.userId, userId));
}

export async function updateJourneyLegs(userId: string, key: string, legs: Leg[]) {
  await getDb()
    .update(journey)
    .set({ legs, updatedAt: new Date() })
    .where(and(eq(journey.userId, userId), eq(journey.key, key)));
}

export type PlanMode = "depart" | "leave_by" | "list";
export type PlanResponse = {
  legs: Leg[];
  plans: Plan[];
  rain: { area: string; forecast: string; rainy: boolean } | null;
  alertLines: string[];
};

function ridesOf(legs: Leg[]) {
  return legs.filter((l): l is Extract<Leg, { kind: "ride" }> => l.kind === "ride");
}

export async function planJourney(legs: Leg[], mode: PlanMode, at: number): Promise<PlanResponse> {
  const rides = ridesOf(legs);
  const codes = [...new Set(rides.map((r) => r.from))];
  const lines = [...new Set(rides.map((r) => r.line))];
  const [data, forecast, alerts] = await Promise.all([
    predictionData(codes, lines, at),
    twoHourForecast(),
    lineAlerts().catch(() => null),
  ]);
  const source = predictionSource(data.observations, data.settings.windows, { sightings: data.sightings, windowsCustom: data.settings.custom });
  const plans =
    mode === "list" ? planList(legs, at, source, 6) : mode === "leave_by" ? [planLeaveBy(legs, at, source)] : [planForward(legs, at, source)];
  const firstStation = rides[0] ? stationForCode(rides[0].from) : undefined;
  const hit = firstStation && forecast ? forecastFor(firstStation, forecast) : null;
  const area = hit?.area;
  const text = hit?.forecast;
  const affected = affectedLines(alerts);
  return {
    legs,
    plans,
    rain: area && text ? { area, forecast: text, rainy: isRainy(text) } : null,
    alertLines: lines.filter((l) => affected.includes(l)),
  };
}

/**
 * Owner Home: next departures + "leave now" for the remaining legs of a
 * journey. Reads observations fresh every call, so a reading saved a
 * moment ago becomes the same-day anchor immediately.
 */
export async function commuteFor(journey: OwnerJourney, progress: CommuteProgress, now: number): Promise<CommuteView> {
  const rides = ridesOf(journey.legs.slice(progress.fromLeg));
  const data = await predictionData([...new Set(rides.map((r) => r.from))], [...new Set(rides.map((r) => r.line))], now).catch(() => null);
  const source = data
    ? predictionSource(data.observations, data.settings.windows, { sightings: data.sightings, windowsCustom: data.settings.custom })
    : predictionSource([], undefined);
  return commuteView(journey.key, journey.legs, progress, source, now);
}

/** Legs for a public route between two stations (≤ 2 transfers). */
export function publicLegs(fromSlug: string, toSlug: string, walkFrom = 0, walkTo = 0): Leg[] | null {
  if (!getStation(fromSlug) || !getStation(toSlug)) return null;
  const route = findRoutes(fromSlug, toSlug, 2)[0];
  return route ? routeToLegs(route, walkFrom, walkTo) : null;
}

export function transfersIn(legs: Leg[]) {
  return Math.max(0, ridesOf(legs).length - 1);
}
export { getPlatform };
