# MRT Time

Singapore MRT next-train times predicted from **timed platform-board readings** (there is no operator live-arrival feed), a **door-to-door commute planner** with transfers, and a **real marketing/analytics practice product** (GA4 + GTM, Meta Pixel + CAPI, Clarity, KOL and campaign tracking, experiments, SEO).

Live at <https://mrt.91208274.xyz> · v1.0.0 · spec: [SPEC.md](SPEC.md)

> This repo is public. Personal data (home/office, owner email, real trip logs and readings) lives only in the database, seeded from the gitignored `private/seed.json`. Tests use synthetic fixtures only.

## Features

| Area | What you get |
|---|---|
| Boards | `/station/[slug]` live board per platform direction: countdowns + clock times, or "every ~N min" ranges, with confidence (high/medium/low) and a plain reason. Crowd chips and service alerts from LTA DataMall; link to the bus app on disruption. Offline: last snapshot. |
| Prediction | `src/lib/predict/`: same-day anchor (≤ 90 min, high confidence) → time-band headway (LTA 2–3 / 5–7 min, overridden by the observed median after ≥ 2 readings) → historical clock-time repeat (v0 port) only outside unstable windows (weekday 09:15–10:30 by default, editable in admin). |
| Planner | `/plan` and the owner home: walk / ride / transfer legs, catchable train per ride, transfer catch (tight / likely / wait ~N), best/worst case, **leave at**, **arrive by** and **next 6** modes, ≤ 2 transfers between any supported stations, rain hint (data.gov.sg) pointing to the sheltered variant. |
| Owner home | Journey auto-picked by time (before 14:00 SGT Home→Office, after Office→Home; a manual pick holds 2 h). **Leave now →** card (arrive ~HH:MM, best–worst, per-leg confidence + reason, best-door tip) and **Next departures** (6 rows: leave → board leg 1 → transfer catch → board leg 2 → arrive, ranges in unstable windows) with a live "leave in m:ss" countdown. Recomputes from the remaining legs right after each tap and after a board reading. |
| Owner | Google / passkey sign-in (`ALLOWED_EMAILS`), journey-aware one-tap logging (At platform → Boarded → Got off → Tap out → Arrived) with 10 s undo, board-reading number pad, saved journeys with editable leg minutes and best-door tips, "leave now" Web Push via QStash, disruption pushes. |
| Crowd-sourcing | `/submit` public readings: rate limit 10/hour per device + daily IP hash; auto-approved when within ±2 min of an approved reading (or same-day prediction) in the same 30-min window, else moderated in `/admin/submissions`. Hermes posts readings/events to `/api/ingest`. |
| Accuracy | Every owner "board" stores what was predicted for that moment; `/accuracy` shows hit rate (±1 min) by line, station and time band. |
| Analytics | First-party `event_log` in Neon (zod-validated, no PII), Consent Mode v2 basic, GTM/gtag mirror, Meta Pixel + CAPI dedup, Clarity, Web Vitals, server-side anonymous page hits, first/last-touch UTM, internal-traffic flag, practice GA4 sandbox with synthetic data + cost CSV. |
| Marketing | KOLs (`/k/[handle]`, `/r/[code]`), campaign builder with QR (SVG/PNG), experiments (landing hero A/B), feedback, NPS, newsletter (Resend double opt-in), `/media-kit`, EN / 繁體中文 (`/zh-Hant/...`), sitemap, robots, OG images, JSON-LD. |
| Admin | `/admin`: DAU/WAU/MAU, new vs returning, sessions, engaged time, top pages/stations/journeys, referrers/UTM, geo, device/standalone, hour × weekday heatmap, weekly retention, funnel, Web Vitals p75, API latency p50/p95, accuracy, submissions queue, campaigns, KOLs, experiments, feedback/NPS, sandbox runs, CSV export. Analysts (`ANALYST_EMAILS`) get read-only analytics. |
| PWA | Installable standalone app, safe areas, `100dvh`, version tag `v<pkg> · <sha> · <SGT build time>` on Home and Settings, update banner via `/api/version`. |

## Stack

Next.js 16 (App Router, Turbopack, `src/proxy.ts`), React 19.3, TypeScript, Tailwind 4, Drizzle ORM 0.45 + Neon (`@neondatabase/serverless`), Better Auth 1.7 (Google + passkey), zod 4, vitest 5 (+ PGlite for SQL tests), pnpm.

## Getting started

```bash
pnpm install
cp .env.example .env.local      # optional — everything works without env (fallback model, no DB)
pnpm dev                        # http://localhost:3000
```

Useful scripts:

| Command | Purpose |
|---|---|
| `pnpm test` | Unit + SQL tests (PGlite runs the generated migrations). |
| `pnpm lint` · `pnpm typecheck` | ESLint · `tsc --noEmit`. |
| `pnpm build` | Production build (needs no env). `pnpm verify:clean` builds a copy with **no** `.env*` files to prove it. |
| `pnpm smoke <baseUrl>` | Post-deploy check without a browser: main pages + APIs return 200, board / plan JSON shapes, `tiong-bahru → shenton-way` list mode gives 6 options with the Outram transfer ≤ 2 min, owner API refuses anonymous calls. |
| `pnpm db:generate` | Generate a Drizzle migration from `src/lib/db/schema.ts` into `drizzle/`. |
| `pnpm db:migrate` | Apply migrations (needs `DATABASE_URL`). |
| `pnpm db:seed` | Upsert owner data from `private/seed.json` (`--dry-run` validates only). |
| `pnpm sandbox:seed` | Backfill the practice GA4 property (last 3 days, MP 72 h limit). |
| `pnpm sandbox:cost --days 14 --out cost.csv` | Synthetic GA4 cost-import CSV. |
| `pnpm qstash:schedules` | Create the 5-minute disruption-check schedule. |
| `pnpm icons` | Re-render PWA icons. |

Local sign-in without Google: `MRT_DEV_BYPASS=1 pnpm dev` (only with `NODE_ENV=development`, and refused when `VERCEL`, `VERCEL_ENV` or `DATABASE_URL` is set). Production never bypasses auth.

## Layout

```
src/
  app/                 routes (pages, API, sitemap/robots/manifest/OG)
  proxy.ts             /zh-Hant rewrite, experiment bucket cookie, anonymous page hits
  lib/
    network/           lines, stations, directions, ride/transfer minutes, routing
    predict/           prediction engine, unstable windows, accuracy, auto-approval
    journey/           planner (depart / arrive-by / list), journey steps, prediction source
    analytics/         event taxonomy, consent, tags, UTM, experiments, ingest, CAPI, admin SQL
    sandbox/           synthetic GA4 MP generator, guarded sender, cost CSV
    server/            DB queries, board, readings, trips, LTA, weather, journeys, metrics
    auth/ db/ push/ i18n/
  components/          UI (board, planner, owner, admin charts, consent, VoC)
scripts/               seed, sandbox, QStash schedules, icons, clean build
drizzle/               SQL migrations
docs/                  setup guides (below)
```

## Docs

- [docs/analytics.md](docs/analytics.md) — event taxonomy, dimensions, privacy model, metric definitions
- [docs/ga4-setup.md](docs/ga4-setup.md) — GA4/GTM admin steps (key events, custom definitions, audiences, explorations, BigQuery, Looker Studio, internal traffic, Google Ads)
- [docs/meta-setup.md](docs/meta-setup.md) — Pixel + Conversions API + test events
- [docs/sandbox.md](docs/sandbox.md) — practice property, Measurement Protocol limits, cost import
- [docs/kol-playbook.md](docs/kol-playbook.md) — creating KOLs, links, codes, dashboard
- [docs/ingest-api.md](docs/ingest-api.md) — Hermes ingest endpoint

## Deploying (Vercel)

1. Set env vars from `.env.example` (only what you use).
2. `pnpm db:migrate` against Neon, then `pnpm db:seed` once the owner data file is in `private/`.
3. `vercel.json` schedules `GET /api/cron/sandbox` daily at 00:30 SGT (needs `CRON_SECRET` and the sandbox GA4 env).
4. Optional: `pnpm qstash:schedules` for disruption pushes (needs VAPID + QStash env and `APP_URL`).

## Privacy

No IP addresses are stored (a salted daily hash is used only for rate limits; Better Auth IP tracking is disabled). Without consent only anonymous aggregate page hits are counted; device ids exist only with analytics consent. Google/Meta/Clarity load only after consent. Event props are enums/slugs (a test fails if any schema accepts email/name/free text); feedback text and newsletter emails stay in Neon.
