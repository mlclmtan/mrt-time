import { platformPrediction } from "@/lib/server/board";
import { json } from "@/lib/server/http";
import { timed } from "@/lib/server/metrics";

/** GET /api/predict?station=EW17&direction=TO_EAST[&at=ISO] */
export const GET = timed("/api/predict", async (request) => {
  const url = new URL(request.url);
  const station = url.searchParams.get("station") || "";
  const direction = url.searchParams.get("direction") || "";
  const atParam = url.searchParams.get("at");
  const at = atParam ? Date.parse(atParam) : Date.now();
  if (!Number.isFinite(at)) return json({ error: "Bad time" }, 400);
  const prediction = await platformPrediction(station, direction, at);
  if (!prediction) return json({ error: "Unknown station or direction" }, 404);
  return json({ station, direction, now: at, prediction });
});
