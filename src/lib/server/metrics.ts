import { after } from "next/server";
import { dbConfigured, getDb } from "../db";
import { apiMetric } from "../db/schema";

/** Record API latency after the response is sent (never blocks a request). */
export function recordLatency(route: string, startedAt: number, status: number) {
  if (!dbConfigured()) return;
  const ms = performance.now() - startedAt;
  try {
    after(async () => {
      await getDb()
        .insert(apiMetric)
        .values({ route, ms, status })
        .catch(() => undefined);
    });
  } catch {
    /* Outside a request scope (tests/scripts): skip. */
  }
}

export function timed(route: string, handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    const started = performance.now();
    const response = await handler(request);
    recordLatency(route, started, response.status);
    return response;
  };
}
