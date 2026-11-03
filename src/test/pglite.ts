/** Real Postgres (PGlite, in-process WASM) with the generated migrations applied. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

export async function testDb() {
  const client = new PGlite();
  const dir = join(process.cwd(), "drizzle");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const statements = readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint");
    for (const statement of statements) if (statement.trim()) await client.exec(statement);
  }
  return { client, db: drizzle(client, { schema }) };
}
