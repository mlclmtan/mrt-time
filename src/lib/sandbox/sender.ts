/**
 * Measurement Protocol sender for the practice property only. It refuses
 * to run without a sandbox ID, and refuses any ID equal to the production
 * measurement ID(s).
 */
import type { MpPayload } from "./generator";

export const MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";
export const MP_DEBUG_ENDPOINT = "https://www.google-analytics.com/debug/mp/collect";

export class SandboxTargetError extends Error {}

/** Production IDs the sandbox must never target. */
export function productionMeasurementIds(env: Record<string, string | undefined> = process.env) {
  return [env.NEXT_PUBLIC_GA_MEASUREMENT_ID, env.GA_PRODUCTION_MEASUREMENT_ID]
    .map((v) => v?.trim().toUpperCase())
    .filter((v): v is string => Boolean(v));
}

export function assertSandboxTarget(measurementId: string | undefined, production: string[]): string {
  const id = measurementId?.trim().toUpperCase();
  if (!id || !/^G-[A-Z0-9]{4,16}$/.test(id)) throw new SandboxTargetError("GA_SANDBOX_MEASUREMENT_ID is missing or malformed");
  if (production.includes(id)) throw new SandboxTargetError("Refusing to send synthetic data to the production GA4 property");
  return id;
}

export function sandboxConfigured(env: Record<string, string | undefined> = process.env) {
  try {
    assertSandboxTarget(env.GA_SANDBOX_MEASUREMENT_ID, productionMeasurementIds(env));
    return Boolean(env.GA_SANDBOX_API_SECRET?.trim());
  } catch {
    return false;
  }
}

export type SendResult = { requests: number; failed: number; events: number };

export async function sendPayloads(
  payloads: MpPayload[],
  opts: {
    measurementId: string | undefined;
    apiSecret: string | undefined;
    production?: string[];
    fetchImpl?: typeof fetch;
    concurrency?: number;
    debug?: boolean;
  },
): Promise<SendResult> {
  const id = assertSandboxTarget(opts.measurementId, opts.production ?? productionMeasurementIds());
  if (!opts.apiSecret?.trim()) throw new SandboxTargetError("GA_SANDBOX_API_SECRET is missing");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.debug ? MP_DEBUG_ENDPOINT : MP_ENDPOINT}?measurement_id=${encodeURIComponent(id)}&api_secret=${encodeURIComponent(opts.apiSecret.trim())}`;
  let requests = 0;
  let failed = 0;
  let events = 0;
  let next = 0;
  const worker = async () => {
    while (next < payloads.length) {
      const payload = payloads[next++];
      // Every synthetic event is labelled, whatever the generator did.
      for (const e of payload.events) e.params.data_source = "synthetic";
      try {
        const res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000),
        });
        requests++;
        if (!res.ok) failed++;
        else events += payload.events.length;
      } catch {
        requests++;
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 8) }, worker));
  return { requests, failed, events };
}
