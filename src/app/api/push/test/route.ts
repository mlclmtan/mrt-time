import { sendTestPush } from "@/lib/push/send";
import { json, readJson, requireRole } from "@/lib/server/http";

export async function POST(request: Request) {
  const auth = await requireRole(request, ["owner"]);
  if ("response" in auth) return auth.response;
  const endpoint = ((await readJson(request)) as { endpoint?: string } | null)?.endpoint;
  if (!endpoint) return json({ error: "Missing endpoint" }, 400);
  return json(await sendTestPush(auth.user.id, endpoint));
}
