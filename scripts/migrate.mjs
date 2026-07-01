// Create the schema and seed observations. Idempotent — safe to re-run.
// Usage: DATABASE_URL=... node scripts/migrate.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { OBSERVATIONS } from '../lib/data.js';

// The Pool (TCP/WebSocket) client needs a WebSocket implementation in Node.
neonConfig.webSocketConstructor = ws;

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }

const pool = new Pool({ connectionString: url });

const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf8');
for (const stmt of schema.split(';').map((s) => s.trim()).filter(Boolean)) {
  await pool.query(stmt);
}
console.log('Schema applied.');

let inserted = 0;
for (const o of OBSERVATIONS) {
  const res = await pool.query(
    `INSERT INTO observations
       (line, station_code, captured_at, direction, dest_code, dest_name, next_min, next_next_min, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (line, station_code, captured_at, direction, dest_code) DO NOTHING
     RETURNING id`,
    [o.line, o.station, o.capturedAt, o.direction, o.destCode, o.destName, o.nextMin, o.nextNextMin ?? null, o.source ?? null],
  );
  if (res.rowCount) inserted += 1;
}
console.log(`Seed complete. ${inserted} new observation(s), ${OBSERVATIONS.length - inserted} already present.`);
await pool.end();
