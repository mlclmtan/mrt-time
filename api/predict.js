import { LINES, STATIONS } from '../lib/data.js';
import { loadObservations } from '../lib/load.js';
import { predictDirection, inService } from '../lib/predict.js';

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const lineCode = url.searchParams.get('line') || 'TEL';
  const stationCode = url.searchParams.get('station') || 'TE14';

  const line = LINES[lineCode];
  const station = STATIONS[stationCode];
  if (!line || !station) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'Unknown line or station' }));
  }

  const now = new Date();
  const { rows, source } = await loadObservations(lineCode, stationCode);

  const directions = Object.values(line.directions).map((dir) => {
    const obs = rows.filter((o) => o.direction === dir.key);
    const prediction = predictDirection(obs, now);
    return { key: dir.key, label: dir.label, towards: dir.towards, prediction };
  });

  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({
    line: { code: line.code, name: line.name, color: line.color },
    station: { code: station.code, name: station.name },
    now: now.toISOString(),
    inService: inService(line, now),
    dataSource: source,
    sampleCount: rows.length,
    directions,
  }));
}
