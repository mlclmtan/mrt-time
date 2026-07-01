import { loadObservations } from '../lib/load.js';
import { insertObservation } from '../lib/db.js';

// GET  /api/observations?line=TEL&station=TE14  -> list observations
// POST /api/observations  (Bearer ADMIN_TOKEN)  -> add one observation
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');

  if (req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { rows, source } = await loadObservations(
      url.searchParams.get('line'),
      url.searchParams.get('station'),
    );
    res.statusCode = 200;
    return res.end(JSON.stringify({ dataSource: source, count: rows.length, observations: rows }));
  }

  if (req.method === 'POST') {
    const token = process.env.ADMIN_TOKEN;
    if (!token) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'Writes disabled (no ADMIN_TOKEN)' })); }
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${token}`) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'Unauthorized' })); }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
    }
    const required = ['line', 'station', 'capturedAt', 'direction', 'nextMin'];
    if (!body || required.some((k) => body[k] == null)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: `Missing fields; required: ${required.join(', ')}` }));
    }
    try {
      const id = await insertObservation(body);
      res.statusCode = 201;
      return res.end(JSON.stringify({ id }));
    } catch (err) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}
