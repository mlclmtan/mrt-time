import { connection } from "next/server";
import { currentBuild } from "@/lib/build-info";

/** The build this server runs. Never cached, so open pages see deploys. */
export async function GET() {
  await connection();
  return Response.json(currentBuild(), { headers: { "Cache-Control": "no-store, max-age=0" } });
}
