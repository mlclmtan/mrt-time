import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { devBypassAllowed, roleFor, type Role } from "./access";
import { relyingParty } from "./passkey";

let cached: ReturnType<typeof createAuth> | undefined;
const permitted = (email: string) => roleFor(email) !== null;

function createAuth() {
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET!,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "missing",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "missing",
      },
    },
    // The owner row is pre-created by scripts/seed.ts; link Google to it on first sign-in.
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    // Privacy: never store IP addresses on sessions.
    advanced: { ipAddress: { disableIpTracking: true } },
    session: {
      expiresIn: 60 * 60 * 24 * 90,
      updateAge: 60 * 60 * 24,
      // Signed cookie cache avoids a DB read on every page render.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      validateUserInfo: (info) =>
        permitted(info.user.email || "")
          ? undefined
          : { error: "not_invited", errorDescription: "MRT Time sign-in is invite only." },
    },
    databaseHooks: {
      user: {
        create: { before: async (person) => (permitted(person.email) ? { data: person } : false) },
      },
      session: {
        create: {
          before: async (newSession) => {
            const found = await getDb().query.user.findFirst({ where: (u, { eq }) => eq(u.id, newSession.userId) });
            return found && permitted(found.email) ? { data: newSession } : false;
          },
        },
      },
    },
    plugins: [passkey({ rpName: "MRT Time", ...relyingParty(process.env.BETTER_AUTH_URL) })],
  });
}

export function authConfigured() {
  return Boolean(
    process.env.DATABASE_URL &&
      process.env.BETTER_AUTH_SECRET &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET,
  );
}
export function getAuth() {
  if (!authConfigured()) throw new Error("Authentication is not configured");
  return (cached ??= createAuth());
}

export type SessionUser = { id: string; email: string; name: string; role: Role };

const DEV_USER: SessionUser = { id: "dev-user", email: "dev@localhost", name: "Dev", role: "owner" };

/** The signed-in owner/analyst, or null. Production never bypasses auth. */
export async function getSession(): Promise<{ user: SessionUser } | null> {
  if (devBypassAllowed() && !authConfigured()) return { user: DEV_USER };
  if (!authConfigured()) return null;
  try {
    const session = await getAuth().api.getSession({ headers: await headers() });
    const role = roleFor(session?.user.email);
    return session && role
      ? { user: { id: session.user.id, email: session.user.email, name: session.user.name, role } }
      : null;
  } catch {
    return null;
  }
}
