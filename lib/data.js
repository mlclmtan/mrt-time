// Canonical reference data + the observations extracted from board photos.
//
// This file is the single source of truth for seeding the database and is
// also used as an in-memory fallback so the app renders even if the database
// is briefly unreachable (Neon cold start, etc.).
//
// A "direction" groups trains by which end of the line they head toward, since
// the terminating station shown on the board varies (e.g. some westbound trains
// terminate at Springleaf TE4, others run all the way to Woodlands North TE1).

export const LINES = {
  TEL: {
    code: 'TEL',
    name: 'Thomson–East Coast Line',
    color: '#9D5B25', // official TEL brown
    // Service window (Singapore local, minutes since midnight). Approximate.
    serviceStart: 5 * 60 + 30, // ~05:30
    serviceEnd: 24 * 60 + 30, // ~00:30 next day
    directions: {
      TO_BAYSHORE: { key: 'TO_BAYSHORE', label: 'To Bayshore', towards: 'TE29' },
      TO_NORTH: { key: 'TO_NORTH', label: 'To Woodlands Nth', towards: 'TE1' },
    },
  },
};

export const STATIONS = {
  'TE14': { code: 'TE14', line: 'TEL', name: 'Orchard', lat: 1.3043, lng: 103.8324 },
};

// Board observations. `capturedAt` is an ISO string with the +08:00 offset
// (Singapore). `nextMin` / `nextNextMin` are the minutes shown on the board.
// `nextNextMin` may be null when the second arrival was not displayed.
export const OBSERVATIONS = [
  // IMG_6524.HEIC — 2026-06-22 10:04:56 SGT (Monday, off-peak morning)
  {
    line: 'TEL', station: 'TE14',
    capturedAt: '2026-06-22T10:04:56+08:00',
    direction: 'TO_BAYSHORE', destCode: 'TE29', destName: 'Bayshore',
    nextMin: 3, nextNextMin: 8, source: 'IMG_6524.HEIC',
  },
  {
    line: 'TEL', station: 'TE14',
    capturedAt: '2026-06-22T10:04:56+08:00',
    direction: 'TO_NORTH', destCode: 'TE4', destName: 'Springleaf',
    nextMin: 2, nextNextMin: null, source: 'IMG_6524.HEIC',
  },
  // IMG_6975.HEIC — 2026-07-01 22:09:01 SGT (Wednesday, off-peak evening)
  {
    line: 'TEL', station: 'TE14',
    capturedAt: '2026-07-01T22:09:01+08:00',
    direction: 'TO_BAYSHORE', destCode: 'TE29', destName: 'Bayshore',
    nextMin: 5, nextNextMin: 11, source: 'IMG_6975.HEIC',
  },
  {
    line: 'TEL', station: 'TE14',
    capturedAt: '2026-07-01T22:09:01+08:00',
    direction: 'TO_NORTH', destCode: 'TE1', destName: 'Woodlands North',
    nextMin: 4, nextNextMin: 10, source: 'IMG_6975.HEIC',
  },
];
