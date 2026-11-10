import { json } from "@/lib/server/http";
import { timed } from "@/lib/server/metrics";
import { getSession } from "@/lib/auth/server";
import { ownerJourneys, planJourney, publicLegs, type PlanMode } from "@/lib/server/journeys";
import { sgtDate, sgtInstant } from "@/lib/time";
import { shelteredSuggestion } from "@/lib/journey/source";

function parseWhen(value: string | null, now: number): number | null {
  if (!value) return now;
  if (/^\d{2}:\d{2}$/.test(value)) {
    try {
      return sgtInstant(sgtDate(now), value);
    } catch {
      return null;
    }
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * GET /api/plan?from=tiong-bahru&to=shenton-way&walkFrom=9&walkTo=5&mode=depart|leave_by|list&time=HH:MM
 * GET /api/plan?journey=home_to_office&mode=… (owner only)
 */
export const GET = timed("/api/plan", async (request) => {
  const url = new URL(request.url);
  const p = url.searchParams;
  const mode = (["depart", "leave_by", "list"].includes(p.get("mode") || "") ? p.get("mode") : "depart") as PlanMode;
  const at = parseWhen(p.get("time"), Date.now());
  if (at == null) return json({ error: "Bad time" }, 400);
  const clampMin = (v: string | null) => Math.max(0, Math.min(60, Math.round(Number(v) || 0)));

  const journeyKey = p.get("journey");
  if (journeyKey) {
    const session = await getSession();
    if (session?.user.role !== "owner") return json({ error: "Please sign in." }, 401);
    const all = await ownerJourneys(session.user.id);
    const journey = all.find((j) => j.key === journeyKey);
    if (!journey) return json({ error: "Unknown journey" }, 404);
    const planned = await planJourney(journey.legs, mode, at, { detail: true });
    // Rain: point at the sheltered variant of the same trip, if this one isn't.
    const variants = all.filter((j) => j.fromPlace === journey.fromPlace && j.toPlace === journey.toPlace);
    const sheltered = !journey.sheltered ? shelteredSuggestion(variants, planned.rain?.rainy ?? false) : null;
    return json({
      journey: { key: journey.key, name: journey.name, sheltered: journey.sheltered },
      shelteredAlternative: sheltered ? { key: sheltered.key, name: sheltered.name } : null,
      ...planned,
    });
  }

  const legs = publicLegs(p.get("from") || "", p.get("to") || "", clampMin(p.get("walkFrom")), clampMin(p.get("walkTo")));
  if (!legs) return json({ error: "No route between those stations" }, 404);
  // How trains are known only for the signed-in owner (predict/privacy.ts).
  const detail = (await getSession())?.user.role === "owner";
  return json(await planJourney(legs, mode, at, { detail }));
});
