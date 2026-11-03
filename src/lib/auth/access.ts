/**
 * Who may sign in: owners (ALLOWED_EMAILS) and read-only analysts
 * (ANALYST_EMAILS, optional). Empty lists let nobody in (fail closed).
 */
export type Role = "owner" | "analyst";

function list(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function emailPermitted(email: string, allowed: string | undefined): boolean {
  const wanted = email.trim().toLowerCase();
  return Boolean(wanted) && list(allowed).includes(wanted);
}

export function roleFor(
  email: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): Role | null {
  if (!email) return null;
  if (emailPermitted(email, env.ALLOWED_EMAILS)) return "owner";
  if (emailPermitted(email, env.ANALYST_EMAILS)) return "analyst";
  return null;
}

/**
 * Local UI work without Google: only under `next dev`, and never when the
 * app could be a deployment (VERCEL / VERCEL_ENV) or has a real database.
 */
export function devBypassAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.NODE_ENV === "development" &&
    !env.VERCEL &&
    !env.VERCEL_ENV &&
    !env.DATABASE_URL &&
    env.MRT_DEV_BYPASS === "1"
  );
}
