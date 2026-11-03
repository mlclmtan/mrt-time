import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Db = ReturnType<typeof makeDb>;
let cached: Db | undefined;
function makeDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for database requests");
  return drizzle(neon(url), { schema });
}
/** Lazily created; never at import time so builds pass without env. */
export function getDb(): Db {
  return (cached ??= makeDb());
}
export function dbConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}
/** Rows from `db.execute()` across drivers (neon-http, pglite). */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] })?.rows ?? []) as T[];
}
