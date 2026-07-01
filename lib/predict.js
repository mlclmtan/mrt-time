// Deterministic train-arrival prediction from timed board observations.
//
// Model: each observation, taken at a known clock time, tells us the actual
// arrival time of the next train (capture time + minutes on board) and often
// the local headway (next-next minus next). MRT schedules repeat by time-of-day
// and day-type (weekday vs weekend), so to predict at some "now" we pick the
// observation whose capture time-of-day (and day-type) is closest to now, then
// project its arrival forward/backward by the headway to the first train >= now.
//
// More observations spread across the day and both day-types => a closer anchor
// is always available => tighter predictions.

const TZ = 'Asia/Singapore';
const DAY = 24 * 60; // minutes in a day
const DEFAULT_HEADWAY = 5; // minutes, fallback when a headway is unknown

// Break a Date into Singapore-local parts we care about.
export function sgParts(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const hour = +p.hour % 24;
  const tod = hour * 60 + +p.minute + +p.second / 60; // minutes since midnight
  const isWeekend = p.weekday === 'Sat' || p.weekday === 'Sun';
  return { tod, weekday: p.weekday, isWeekend, ymd: `${p.year}-${p.month}-${p.day}` };
}

// Smallest signed circular distance between two times-of-day (minutes).
function circularDelta(a, b) {
  let d = ((a - b) % DAY + DAY) % DAY;
  if (d > DAY / 2) d -= DAY;
  return d;
}

// Median of numbers (ignoring null/undefined).
function median(nums) {
  const xs = nums.filter((n) => n != null).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Precompute per-observation fields used by the predictor.
function enrich(obs) {
  const cap = sgParts(new Date(obs.capturedAt));
  const headway = obs.nextNextMin != null ? obs.nextNextMin - obs.nextMin : null;
  return {
    ...obs,
    captureTod: cap.tod,
    isWeekend: cap.isWeekend,
    arrivalTod: cap.tod + obs.nextMin, // time-of-day the next train arrived
    headway,
  };
}

// Predict for one direction given its observations and "now".
// Returns null if there is nothing to predict from.
export function predictDirection(observations, now = new Date()) {
  if (!observations || !observations.length) return null;
  const enriched = observations.map(enrich);
  const nowP = sgParts(now);

  // Prefer observations from the same day-type; fall back to all.
  const sameType = enriched.filter((o) => o.isWeekend === nowP.isWeekend);
  const pool = sameType.length ? sameType : enriched;
  const dayTypeMatch = sameType.length > 0;

  // Anchor = observation whose capture time-of-day is nearest to now.
  let anchor = pool[0];
  let best = Math.abs(circularDelta(pool[0].captureTod, nowP.tod));
  for (const o of pool) {
    const d = Math.abs(circularDelta(o.captureTod, nowP.tod));
    if (d < best) { best = d; anchor = o; }
  }

  const headway = anchor.headway
    ?? median(enriched.map((o) => o.headway))
    ?? DEFAULT_HEADWAY;

  // Project the anchor's arrival to the first train at/after now (time-of-day).
  // k*headway steps from the anchor arrival, chosen so arrival >= now.
  const gap = nowP.tod - anchor.arrivalTod;
  let k = Math.ceil(gap / headway);
  let minsToNext = anchor.arrivalTod + k * headway - nowP.tod;
  // Guard against tiny negative from float rounding.
  if (minsToNext < -1e-6) { k += 1; minsToNext = anchor.arrivalTod + k * headway - nowP.tod; }

  const minsToNextNext = minsToNext + headway;

  // Confidence from how far now is from the anchor's capture time.
  const anchorGap = Math.abs(circularDelta(anchor.captureTod, nowP.tod)); // minutes
  let confidence = 'low';
  if (anchorGap <= 30 && dayTypeMatch) confidence = 'high';
  else if (anchorGap <= 120) confidence = 'medium';

  return {
    minsToNext: Math.max(0, minsToNext),
    minsToNextNext: Math.max(0, minsToNextNext),
    headway,
    destCode: anchor.destCode,
    destName: anchor.destName,
    confidence,
    anchorCapturedAt: anchor.capturedAt,
    anchorGapMin: Math.round(anchorGap),
    sampleCount: observations.length,
    dayTypeMatch,
  };
}

// Whether the line is within service hours at "now".
// serviceEnd may exceed 1440 (DAY) to represent trains running past midnight.
export function inService(line, now = new Date()) {
  const { tod } = sgParts(now);
  const start = line.serviceStart ?? 0;
  const end = line.serviceEnd ?? DAY;
  if (end <= DAY) return tod >= start && tod <= end;
  // Past-midnight: e.g. start=330, end=1470 -> tod>=330 OR tod<=30.
  return tod >= start || tod <= end - DAY;
}
