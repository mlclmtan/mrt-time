import { pushAvailable, schedulingAvailable } from "@/lib/push/config";
import { json } from "@/lib/server/http";

export async function GET() {
  return json({
    push: pushAvailable(),
    scheduling: schedulingAvailable(),
    publicKey: pushAvailable() ? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY : null,
  });
}
