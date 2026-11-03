import { getSession, type SessionUser } from "../auth/server";
import type { Role } from "../auth/access";

/** Browser mutations must originate from this app. */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export const json = (value: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store, max-age=0", ...extra } });

/** The signed-in user with one of the roles, or a ready-made error response. */
export async function requireRole(
  request: Request | undefined,
  roles: Role[] = ["owner"],
): Promise<{ user: SessionUser } | { response: Response }> {
  if (request && request.method !== "GET" && !sameOrigin(request))
    return { response: json({ error: "Invalid origin" }, 403) };
  const session = await getSession();
  if (!session) return { response: json({ error: "Please sign in again." }, 401) };
  if (!roles.includes(session.user.role)) return { response: json({ error: "Not allowed" }, 403) };
  return { user: session.user };
}

export const noDb = () => json({ error: "The database isn't configured yet." }, 503);

export async function readJson(request: Request) {
  return request.json().catch(() => null);
}

/** Constant-time-ish bearer check (length + every char). */
export function bearerMatches(request: Request, secret: string | undefined) {
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < header.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
