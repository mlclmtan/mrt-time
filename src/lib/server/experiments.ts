import { eq } from "drizzle-orm";
import { headers, cookies } from "next/headers";
import { dbConfigured, getDb } from "../db";
import { experiment } from "../db/schema";
import { assignAll, BUCKET_COOKIE, DEFAULT_EXPERIMENTS, type ExperimentDef } from "../analytics/experiments";

let cache: { at: number; value: ExperimentDef[] } | null = null;

export async function activeExperiments(now = Date.now()): Promise<ExperimentDef[]> {
  if (!dbConfigured()) return DEFAULT_EXPERIMENTS;
  if (cache && now - cache.at < 60_000) return cache.value;
  try {
    const rows = await getDb().select().from(experiment).where(eq(experiment.active, true));
    const value = rows.length
      ? rows.map((r) => ({ key: r.key, active: r.active, variants: (r.variants as ExperimentDef["variants"]) ?? [] }))
      : DEFAULT_EXPERIMENTS;
    cache = { at: now, value };
    return value;
  } catch {
    return DEFAULT_EXPERIMENTS;
  }
}

/** Sticky assignments for this browser (bucket seed set by the proxy). */
export async function experimentAssignments(): Promise<Record<string, string>> {
  const seed = (await headers()).get("x-mrt-bucket") || (await cookies()).get(BUCKET_COOKIE)?.value;
  if (!seed) return {};
  return assignAll(seed, await activeExperiments());
}
