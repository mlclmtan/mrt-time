import { sql } from "drizzle-orm";
import { getDb, rowsOf } from "../db";
import { HOUR } from "../time";
import type { RateLimiter } from "../predict/readings";

/** Fixed hourly window in Postgres (works across serverless instances). */
export class DbRateLimiter implements RateLimiter {
  constructor(
    private bucket: string,
    private limit: number,
  ) {}
  async hit(key: string, now: number) {
    const windowStart = new Date(Math.floor(now / HOUR) * HOUR).toISOString();
    const result = await getDb().execute(sql`
      insert into rate_limit (bucket, key, window_start, count)
      values (${this.bucket}, ${key}, ${windowStart}::timestamptz, 1)
      on conflict (bucket, key, window_start) do update set count = rate_limit.count + 1
      returning count`);
    const count = Number(rowsOf<{ count: number }>(result)[0]?.count ?? 1);
    return { allowed: count <= this.limit, remaining: Math.max(0, this.limit - count) };
  }
}
