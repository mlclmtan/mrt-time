import { neon } from '@neondatabase/serverless';

// A single shared SQL tag. Returns null when no database is configured so
// callers can fall back to bundled data instead of crashing.
let _sql = null;
export function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

// Fetch observations, optionally filtered by line and station.
export async function fetchObservations(line, station) {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`
    SELECT line, station_code AS station, captured_at AS "capturedAt",
           direction, dest_code AS "destCode", dest_name AS "destName",
           next_min AS "nextMin", next_next_min AS "nextNextMin", source
    FROM observations
    WHERE (${line}::text IS NULL OR line = ${line})
      AND (${station}::text IS NULL OR station_code = ${station})
    ORDER BY captured_at ASC`;
  return rows.map((r) => ({ ...r, capturedAt: new Date(r.capturedAt).toISOString() }));
}

export async function insertObservation(o) {
  const sql = getSql();
  if (!sql) throw new Error('No database configured');
  const [row] = await sql`
    INSERT INTO observations
      (line, station_code, captured_at, direction, dest_code, dest_name, next_min, next_next_min, source)
    VALUES (${o.line}, ${o.station}, ${o.capturedAt}, ${o.direction},
            ${o.destCode}, ${o.destName}, ${o.nextMin}, ${o.nextNextMin ?? null}, ${o.source ?? null})
    RETURNING id`;
  return row.id;
}
