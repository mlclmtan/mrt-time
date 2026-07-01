# MRT Time

A very simple web app that predicts the **next** and **next-next** train arrival for
Singapore MRT stations, and shows how many minutes are left until each train.

Currently live for the **Thomson–East Coast Line (TEL)** at **Orchard (TE14)**.

## How it works

There is no live feed from the operator. Instead, predictions come from **timed photos
of the platform arrival board**:

1. A photo's EXIF capture time + the minutes shown on the board = a real arrival time.
2. The gap between the two arrivals shown = the local **headway** (train frequency).
3. MRT schedules repeat by **time of day** and **day type** (weekday vs weekend), so to
   predict for "now" the app picks the observation whose capture time-of-day and day-type
   are closest, then projects arrivals forward by the headway to the first train ≥ now.

**More photos across the day ⇒ a closer anchor is always available ⇒ sharper predictions.**

### Why extraction is manual (by design)

Reading the board from a photo automatically would require a paid vision model call on
every upload. This app deliberately does **no model calls at runtime** — it is pure,
deterministic schedule math, so it costs nothing to run. Board readings are extracted from
photos and loaded into the data set (see below), and the deployed app only does prediction
and display.

## Data captured so far

| Photo | Captured (SGT) | To Bayshore (TE29) | To Woodlands North (TE1) |
|-------|----------------|--------------------|--------------------------|
| IMG_6524 | 2026-06-22 10:04 Mon | 3, 8 min | 2 min (→ Springleaf TE4) |
| IMG_6975 | 2026-07-01 22:09 Wed | 5, 11 min | 4, 10 min |

Station identified from photo GPS (1.3043°N, 103.832°E → Orchard TE14).

## Architecture

- **Frontend** — static `index.html` / `style.css` / `app.js`. No framework, no build step,
  no external assets. Auto-refreshes every 30 s and ticks the countdown every second.
- **API** — Vercel serverless functions in `/api`:
  - `GET /api/predict?line=TEL&station=TE14` — current predictions per direction.
  - `GET /api/observations` — the board readings on record.
  - `POST /api/observations` — add a reading (requires `Authorization: Bearer $ADMIN_TOKEN`).
- **Database** — Neon Postgres (`observations` table). The API falls back to bundled data
  in `lib/data.js` if the database is briefly unreachable, so the page always renders.
- **Prediction engine** — `lib/predict.js` (pure functions, timezone-aware, no dependencies).

## Adding more board readings

Each new photo improves accuracy. Two ways to add one:

**A. Bundled + redeploy** — add an entry to `OBSERVATIONS` in [`lib/data.js`](lib/data.js),
then `npm run migrate` and redeploy.

**B. Live via API** — no redeploy needed:

```bash
curl -X POST "$APP_URL/api/observations" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"line":"TEL","station":"TE14","capturedAt":"2026-07-02T08:15:00+08:00",
       "direction":"TO_BAYSHORE","destCode":"TE29","destName":"Bayshore",
       "nextMin":4,"nextNextMin":9,"source":"IMG_1234.HEIC"}'
```

`direction` is `TO_BAYSHORE` (eastbound) or `TO_NORTH` (toward Woodlands North).

## Local development

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and ADMIN_TOKEN
npm run migrate             # create schema + seed observations
npm run dev                 # vercel dev (http://localhost:3000)
```

## Environment variables

| Name | Purpose |
|------|---------|
| `DATABASE_URL` | Neon Postgres pooled connection string. |
| `ADMIN_TOKEN`  | Bearer token guarding `POST /api/observations`. Writes are disabled if unset. |

## Roadmap

- North–South Line (NSL) — a board photo is already on file.
- Station picker once more than one station has data.
- Peak/off-peak headway bands as more readings accumulate.
