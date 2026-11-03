import { stationBoard } from "@/lib/server/board";
import { json } from "@/lib/server/http";
import { timed } from "@/lib/server/metrics";
import { lineAlerts, crowdForStations } from "@/lib/server/lta";
import { getStation } from "@/lib/network";

/** GET /api/board?station=outram-park — every platform direction + alerts + crowd. */
export const GET = timed("/api/board", async (request) => {
  const slug = new URL(request.url).searchParams.get("station") || "";
  const station = getStation(slug);
  if (!station) return json({ error: "Unknown station" }, 404);
  const [board, alerts, crowd] = await Promise.all([
    stationBoard(slug),
    lineAlerts().catch(() => null),
    crowdForStations(station.codes).catch(() => null),
  ]);
  return json({ board, alerts, crowd });
});
