import { Client, Receiver } from "@upstash/qstash";
const DEFAULT_QSTASH_URL = "https://qstash.upstash.io";
/**
 * The QStash API origin. Accounts live in one region (e.g. EU:
 * https://qstash-eu-central-1.upstash.io) and a token only works against its
 * own region, so honour QSTASH_URL; unset keeps the global default.
 */
export function qstashBaseUrl(
  env: Record<string, string | undefined> = process.env,
) {
  const value = env.QSTASH_URL?.trim().replace(/\/+$/, "");
  if (!value) return DEFAULT_QSTASH_URL;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : DEFAULT_QSTASH_URL;
  } catch {
    return DEFAULT_QSTASH_URL;
  }
}
export function qstashHost() {
  return new URL(qstashBaseUrl()).host;
}
export function qstashClient() {
  return new Client({
    token: process.env.QSTASH_TOKEN!,
    baseUrl: qstashBaseUrl(),
    // Never let a stray QSTASH_DEV switch production to the local dev server.
    devMode: false,
  });
}
/**
 * Verify a QStash delivery: the JWT signature (current or rotated key), the
 * destination URL in its subject and the raw body hash. Returns the raw body.
 */
export async function verifyQStash(
  request: Request,
  url: string,
): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
  const signature = request.headers.get("upstash-signature");
  if (!signature)
    return {
      ok: false,
      response: Response.json({ error: "Missing signature" }, { status: 401 }),
    };
  const body = await request.text();
  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
    devMode: false,
  });
  try {
    if (await receiver.verify({ signature, body, url }))
      return { ok: true, body };
  } catch {
    /* Falls through to 401. */
  }
  return {
    ok: false,
    response: Response.json({ error: "Invalid signature" }, { status: 401 }),
  };
}
/** Short, PII-free reason for logs and the Push health panel. */
export function failureReason(error: unknown) {
  const value = error as { name?: string; message?: string; status?: number };
  const text = `${value?.name || "Error"}: ${value?.message || String(error)}`;
  return text.replace(/\s+/g, " ").slice(0, 160);
}
