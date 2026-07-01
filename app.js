'use strict';

const LINE = 'TEL';
const STATION = 'TE14';
const REFRESH_MS = 30000; // re-fetch from server every 30s
const TICK_MS = 1000; // re-render countdown locally every second

const board = document.getElementById('board');
const updatedEl = document.getElementById('updated');
const closedEl = document.getElementById('closed');
const howBtn = document.getElementById('how');
const howPanel = document.getElementById('how-panel');
const howStats = document.getElementById('how-stats');

let state = null; // last server payload
let fetchedAt = 0; // Date.now() when payload arrived

function fmtClock(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

// Minutes shifted by time elapsed since the payload was fetched, so the
// countdown ticks down smoothly between server refreshes.
function liveMins(baseMin) {
  const elapsed = (Date.now() - fetchedAt) / 60000;
  return baseMin - elapsed;
}

function label(min) {
  if (min <= 0.5) return { text: 'Arriving', arriving: true };
  return { text: String(Math.round(min)), arriving: false };
}

function render() {
  if (!state) return;

  document.getElementById('station-name').textContent = state.station.name;
  document.getElementById('line-name').textContent = state.line.name;
  closedEl.hidden = state.inService;

  board.innerHTML = '';
  board.setAttribute('aria-busy', 'false');

  for (const dir of state.directions) {
    const card = document.createElement('article');
    card.className = 'card';
    const p = dir.prediction;

    if (!p) {
      card.innerHTML = `<div class="card-top"><span class="direction">${dir.label}</span></div>
        <p class="empty">No timing data yet for this direction.</p>`;
      board.appendChild(card);
      continue;
    }

    // Out of service hours: countdowns would be misleading, so show a muted state.
    if (!state.inService) {
      card.classList.add('closed-card');
      card.innerHTML = `
        <div class="card-top">
          <span class="direction">${dir.label}</span>
          <span class="dest"><span class="code">${p.destCode}</span>${p.destName}</span>
        </div>
        <div class="next"><span class="mins closed-mins">—</span><span class="unit">Not running</span></div>`;
      board.appendChild(card);
      continue;
    }

    const nextMin = liveMins(p.minsToNext);
    const nextNextMin = liveMins(p.minsToNextNext);
    const n = label(nextMin);
    const arriveAt = new Date(Date.now() + Math.max(0, nextMin) * 60000);
    const arriveAt2 = new Date(Date.now() + Math.max(0, nextNextMin) * 60000);

    const confText = { high: 'High confidence', medium: 'Estimated', low: 'Rough estimate' }[p.confidence];

    card.innerHTML = `
      <div class="card-top">
        <span class="direction">${dir.label}</span>
        <span class="dest"><span class="code">${p.destCode}</span>${p.destName}</span>
      </div>
      <div class="next">
        <span class="mins${n.arriving ? ' arriving' : ''}">${n.text}</span>
        ${n.arriving ? '' : '<span class="unit">min</span>'}
        <span class="unit" style="margin-left:auto">${fmtClock(arriveAt)}</span>
      </div>
      <div class="then">
        Then <b>${Math.max(0, Math.round(nextNextMin))}</b> min
        <span class="conf ${p.confidence}"><span class="cdot"></span>${confText}</span>
        <span class="clock">${fmtClock(arriveAt2)}</span>
      </div>`;
    board.appendChild(card);
  }

  const ago = Math.round((Date.now() - fetchedAt) / 1000);
  const src = state.dataSource === 'db' ? '' : ' · offline data';
  updatedEl.textContent = `Updated ${ago < 5 ? 'just now' : ago + 's ago'}${src}`;
  howStats.textContent =
    `${state.sampleCount} board reading${state.sampleCount === 1 ? '' : 's'} on record · `
    + state.directions.map((d) => d.prediction
      ? `${d.label}: ~${d.prediction.headway} min headway`
      : `${d.label}: —`).join(' · ');
}

async function refresh() {
  try {
    const res = await fetch(`/api/predict?line=${LINE}&station=${STATION}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state = await res.json();
    fetchedAt = Date.now();
    render();
  } catch (err) {
    updatedEl.textContent = 'Connection issue — retrying…';
  }
}

howBtn.addEventListener('click', () => {
  const open = howPanel.hidden;
  howPanel.hidden = !open;
  howBtn.setAttribute('aria-expanded', String(open));
});

refresh();
setInterval(render, TICK_MS);
setInterval(refresh, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
