import { dbConfigured } from "@/lib/db";
import { confirmSubscription } from "@/lib/server/voc";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ok = dbConfigured() && (await confirmSubscription(url.searchParams.get("token") || ""));
  return Response.redirect(new URL(ok ? "/?subscribed=1" : "/?subscribed=0", url.origin), 303);
}
