import { fetchObservations } from './db.js';
import { OBSERVATIONS } from './data.js';

// Load observations for a line/station, preferring the database but falling
// back to the bundled data so the app always renders. Returns { rows, source }.
export async function loadObservations(line, station) {
  try {
    const rows = await fetchObservations(line ?? null, station ?? null);
    if (rows && rows.length) return { rows, source: 'db' };
  } catch (err) {
    console.error('DB read failed, using bundled data:', err.message);
  }
  const rows = OBSERVATIONS.filter(
    (o) => (!line || o.line === line) && (!station || o.station === station),
  );
  return { rows, source: 'bundled' };
}
