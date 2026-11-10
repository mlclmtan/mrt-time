# MRT Time — v2.0 spec

Public web app (PWA) that predicts Singapore MRT train arrivals from timed platform-board readings (no operator live-arrival feed exists), plans door-to-door commutes with transfers, and doubles as a **real marketing/analytics practice product** (GA4, GTM, ads tracking, KOL tracking, SEO, experiments).

Live at `mrt.91208274.xyz`. Repo is PUBLIC: never commit personal data (home/office addresses, emails, the owner's real observations/trip logs). Personal data lives only in the DB, seeded from a gitignored file.

## 1. Stack
- Next.js 16 (App Router) on Vercel Hobby, TypeScript, Tailwind 4, Drizzle + Neon Postgres (`@neondatabase/serverless`), Better Auth (Google sign-in primary, passkey optional), zod, vitest. pnpm.
- Sibling reference (read-only): `~/code/bus` (same stack, auth allowlist, PWA, version banner, push, QStash, multi-leg trips with train legs).
- All third-party IDs/keys via env; every integration is a no-op when its env is unset. `pnpm build` passes with no env.

## 2. Users & access
- **Public (no login):** station boards, journey planner, landing/SEO pages, accuracy page, add a board reading (inline on station pages or `/add`; crowdsourced, rate-limited).
- **Signed-in owner (`ALLOWED_EMAILS`):** personal commute (saved places + journeys), one-tap logging, admin dashboard, moderation of public readings, campaign/KOL/experiment management.
- **Analysts (`ANALYST_EMAILS`, optional):** read-only access to `/admin` analytics (for a marketing collaborator). Unset by default.

## 3. Network data (static, in repo)
- **Every MRT line and station** (v2.0, see §18): NSL, EWL (incl. the Changi Airport branch CG), NEL, CCL (incl. Stage 6), DTL, TEL. Data in `src/lib/network/` (`data.ts` lines/directions/details, `stations-list.ts` codes/names/coordinates); sources and licences in `docs/data-sources.md`.
- Line colours (official), service hours (approx 05:30–00:30). A direction is keyed by the destination the platform board shows and lists the **path(s)** its trains run (platform codes in running order ending at the terminal); branches are separate directions (EWL `TO_CHANGI_AIRPORT` / `TO_TANAH_MERAH`). Keys match `^TO_[A-Z][A-Z_]+$` (e.g. `TO_EAST`, `TO_MARINA_SOUTH_PIER`).
- Ride minutes per hop: observed values (EW17→EW16 3, EW15→EW17 5, TE17→TE19 3, TE17→TE2 Woodlands 37; a longer observed ride is spread evenly over its stops without a figure of their own), else 2 min a stop incl. dwell.
- Interchange transfer minutes (platform to platform): Outram Park EW16↔TE17 **2** (observed 0–2; a 0-minute change is real), NE3↔EW16 3, NE3↔TE17 4. Every other interchange is an estimate: 3, or 4 where the walk is known to be long. Branch change at Tanah Merah: 3 (estimate). Never above 4 unless a transfer is known to be long.

## 4. Observations & prediction engine (`src/lib/predict/`, pure, tested)
- **Observation** = board reading: station, line, direction, destination, capturedAt (SGT), minutes shown for next / next-next / optional 3rd train, source (owner | public | hermes), status (approved | pending | rejected).
- Derived: actual arrival clock times; headway = gap between shown trains.
- **Trip events** = owner logs: board / alight / at_platform / tap_in / tap_out / door / desk / etc., timestamp = the moment of the tap (never a server-delayed time).
- Prediction for (station, direction, now):
  1. **Same-day anchor:** an approved reading today at that platform within 90 min → project by its headway (high confidence).
  2. Else **time-band headway model:** LTA-published fallback peak (weekday 07:00–09:00, 17:00–19:00) 2–3 min, off-peak 5–7 min, overridden by the median observed headway for that line/direction/time band once ≥2 readings exist (observed so far: TEL 6 min, EWL 4–6 min off-peak).
  3. **Historical clock-time repeat** (anchor from another day at a similar time-of-day/day-type, as in v0 `lib/predict.js`) is used ONLY outside unstable windows, and since v2.0 only while the learned model (§16) has too few days to decide. **Weekday 09:15–10:30 is marked unstable** (owner observed clock times don't repeat day to day): show "every ~N min" + wait range, never exact clock times from other days. The unstable-window list is data, editable in admin.
  - Output: next arrivals (clock + countdown) or a range, headway, confidence (high/medium/low) + plain reason ("from a reading 12 min ago" / "typical gap at this hour"). The planner and owner Home use this output as is.
- **Station board view-model** (`src/lib/predict/board-view.ts`, pure): station pages **always show clock times, never an interval only**. Each direction card shows the next 3 arrivals as SGT `HH:MM` with a live countdown ("10:24 · in 2 min"):
  - **Exact** (reading today ≤ 90 min, incl. the visitor's own just-saved reading): solid times, chip "From the board", reason "From a board reading N min ago".
  - **Estimate** (another day's reading at a similar time, or the typical gap at this hour): "≈10:24 ±N" with an "Estimate" chip and the plain reason ("Typical gap ~5 min, no board reading yet today"). Gap-only estimates sit on a steady grid from the start of service so they count down between renders. ± = 1 min (historical; 2 if low confidence), ⌈gap/2⌉ (typical gap), and in unstable windows max(3, ⌈gap/2⌉+1) — times are still shown, with the wider band.
- **Accuracy tracking:** when the owner logs `board` at a platform, store the prediction that was shown/computed for that moment (`prediction_check`). Since v2.0 the public `/accuracy` page uses train sightings as ground truth (§16).

## 5. Journeys (planner)
- Journey = ordered legs: walk (fixed min), ride (line, from, to, direction), transfer (fixed min at an interchange). Fixed leg minutes per saved journey are editable.
- Planner computes for a departure time (or "now"): per ride leg the catchable train (arrival at platform + prediction), the transfer catch ("tight"/"likely"/"wait ~N min"), final arrival time, plus best/worst case. "Leave by" mode for a target arrival time. "List" mode: next 6 departures with arrival times (e.g. "leave desk at 12:30" → list).
- Public: pick any two supported stations (+ optional walk minutes) → route via the network with at most 2 transfers.
- Owner (private, from DB seed): saved places Home/Office and journeys Home→Office (walk → EW17 TO_EAST → EW16 transfer → TE17 TO_BAYSHORE → TE19 → walk), Office→Home (reverse), and alternative Office→Home via Tanjong Pagar (walk → EW15 TO_WEST → EW17 → walk). Show best-door tips per leg (data from seed).
- Planner UI: time defaults to now (SGT, server-rendered so SSR and client agree), plans automatically on load and re-plans (debounced) on any input change; only visitor-initiated queries emit `planner_query`. For the owner, From/To (and walk minutes) default to the current journey's stations.
- Rain-aware hint: data.gov.sg 2-hour weather forecast (free, no key) for the relevant area → suggest the more sheltered journey variant when rain is forecast.

## 6. Owner Home & logging
- **Train times first.** Above the logging buttons:
  - Journey auto-selected by SGT time of day (before 14:00 → Home→Office, from 14:00 → Office→Home); a manual pick is remembered for 2 h (cookie `mrt_journey`).
  - **Leave now →** card: arrive ~HH:MM with best–worst, per ride leg the board clock (or range), confidence + reason ("from a board reading 12 min ago" / "typical gap at this hour · every ~6 min"), and the best-door tip from journey data.
  - **Next departures** (list mode, 6 rows): leave at → board leg 1 (line chip + clock) → transfer catch (tight / likely / wait ~N) → board leg 2 → arrive, with a live countdown to the first leave-by. In unstable / headway-only windows rows show ranges, never exact clocks.
  - Recomputed (`GET /api/commute`, owner only) on journey change, immediately after each logging tap (the rest of the trip starts from the platform, the end of the current ride, or where you got off; taps older than 90 min are ignored), right after a board reading is saved (same-day anchor), every minute, and when the first leave-by passes.
- Home screen buttons in context — big **I boarded** / **Got off** plus Leaving (home door / desk), At platform, Tap out, Arrived (desk / home door) — journey-aware (knows the next expected step), time = the tap unless moved with the time chips (§13), undo within 10 s.
- Board reading entry on Home: the same one-tap entry as station pages (below), preset to the next journey platform/direction, with "At a different station?" → `/add`. Optional photo is NOT stored (photos live in Notion).
- `POST /api/ingest` with bearer `INGEST_TOKEN` so Hermes can post readings/events it extracts from photos sent in chat.
### 6a. Simplified reading flow (commuter's words: which way, in how many minutes, when I saw it)
- **One-tap entry**, inline under every direction on station pages, on owner Home and in `/add`: "Board says: next train to Pasir Ris in [ ] min, then [ ] min" (+ optional third train). Large number chips 0–15 fill the next empty box (tap a filled box to clear it) plus a free number input. Time seen = now automatically; "seen at HH:MM · change" opens a time picker (default now, at most 30 min back). Save → 10 s undo toast (`DELETE /api/readings?id=`, own reading only, ≤ 2 min old).
- **No jargon** anywhere in this flow: no "headway", "source", "status", "observation", "direction key" or "dest code"; destinations are named as on the platform board (`Direction.board`, e.g. "Pasir Ris", "Joo Koon / Tuas Link", TEL "Woodlands North" / "Bayshore"). Early-ending trains (`alsoBoard`, e.g. "Springleaf") are grouped under their direction automatically.
- **`/add`** (one screen, one-handed at 393×852): 1 station (default: last used on this device, else the owner's next journey platform, else a searchable list with EN/中文 names and codes) → 2 big direction buttons named like the board (platform chip when the station has several lines) → 3 the same minute chips. `/submit` permanently redirects to `/add`.
- The form posts exactly `{ station, direction, minutes[], seenAt }` to `POST /api/readings` (device id, consented visitors only, in the `x-device-id` header). Minutes are sorted ascending.
- After saving, the card switches to exact times immediately: the reading is kept on the device for 90 min (`mrt_my_readings`) and overrides that direction's view until the server has an anchor at least as fresh; the board is re-fetched at once so other visitors get the anchor when it is approved.
- Public submissions (no login): rate limit per device+IP hash (10/hour), `seenAt` at most 30 min back, status `pending` unless consistent (±2 min) with an approved reading/prediction in the same 30-min window → auto-approve; else owner moderates in admin. The owner's readings auto-approve.

## 7. LTA DataMall (free, `LTA_ACCOUNT_KEY`)
- Train Service Alerts → banner on affected lines/stations; Platform Crowd Density Real Time for the stations above → crowd chip per platform. Cache 1–2 min. Graceful hide when key unset/401.

## 8. Analytics (full)
### 8a. First-party (`event_log` in Neon)
- Anonymous device id (random, localStorage + first-party cookie), session id (30-min inactivity), event name, props (jsonb, zod-validated, no PII, no free text), route, referrer, UTM params (first-touch + last-touch stored per device), viewport, standalone flag, language, experiment assignments, Vercel geo headers (country/region/city only), coarse UA (browser/os/device type). No IP stored (store a salted daily hash only for rate limiting).
- Server-side page-hit logging so non-consenting visitors are counted anonymously in aggregate (no device id without consent? → store device id only when analytics consent granted; otherwise aggregate-only row).
- Web Vitals (LCP/INP/CLS/TTFB) via `web-vitals` → event_log.
- Event taxonomy documented in `docs/analytics.md` and mirrored to GA4 (same names): page_view, station_view, journey_view, planner_query, prediction_view, prediction_feedback, log_reading, log_trip_event, submit_reading, install_prompt_shown, app_installed, standalone_open, share, outbound_click, alert_view, crowd_view, feedback_submit, nps_submit, newsletter_signup, experiment_exposure, kol_landing, campaign_landing, consent_update, web_vital.
### 8b. GA4 + GTM
- Load via **GTM** (`NEXT_PUBLIC_GTM_ID`) with a dataLayer; fallback direct gtag if only `NEXT_PUBLIC_GA_MEASUREMENT_ID` set. **Consent Mode v2 basic:** nothing Google/Meta/Clarity loads until consent; consent banner (accept / reject / customise: analytics, marketing) + Settings toggle; consent_update event.
- Custom dimensions sent as event params: station, line, direction, journey_type, confidence, standalone, language, user_type (owner/analyst/visitor), experiment_id, variant, kol_handle, campaign.
- Internal traffic: owner/analyst sessions set `traffic_type=internal`.
- `docs/ga4-setup.md`: exact admin steps (key events, custom definitions, audiences: commuters, weekend users, installers, churn-risk; Explorations templates; BigQuery link; Looker Studio template; unwanted referrals accounts.google.com; disable history-based page changes since app sends its own page_view).
### 8c. Practice Sandbox (synthetic, clearly labelled)
- `scripts/sandbox-seed.ts` + `GET /api/cron/sandbox` (Vercel cron daily, protected by `CRON_SECRET`) sends synthetic events to a SEPARATE GA4 property via Measurement Protocol (`GA_SANDBOX_MEASUREMENT_ID`, `GA_SANDBOX_API_SECRET`). Every synthetic event carries `data_source=synthetic`. Personas (daily commuter, tourist, student, weekend user, KOL-referred), campaigns (google_ads search, meta_ads reels, tiktok, KOL handles, organic, newsletter), devices, funnels (landing → planner → install → retention), weekday/time seasonality, A/B variants, ~200–600 users/day. MP timestamps allowed up to 72 h back, so backfill only 3 days and grow daily. Verify current MP field support (user_location, device) against Google's docs at build time; document what's supported.
- Synthetic ad cost CSV generator (`scripts/sandbox-cost.ts`) in GA4 cost-data-import format (campaign id, source, medium, date, cost, clicks, impressions) for Meta/TikTok-style campaigns → `docs/sandbox.md` explains the upload.
- **Never** send synthetic data to the production property or event_log (separate table `sandbox_runs` for logs only).
### 8d. Ads & KOL
- Meta Pixel (`NEXT_PUBLIC_META_PIXEL_ID`) behind marketing consent + Conversions API server-side (`META_CAPI_TOKEN`), dedup with shared `event_id`; events: PageView, ViewContent (station), Lead (newsletter), CompleteRegistration (install), custom PlanJourney. `META_TEST_EVENT_CODE` support.
- Google Ads: conversion linking via GA4 (docs only) + optional `NEXT_PUBLIC_GOOGLE_ADS_ID` gtag config.
- **KOL module:** table of KOLs (handle, platform, code, landing variant, notes); `/k/[handle]` landing pages (co-branded, UTM auto-applied: utm_source=handle, utm_medium=kol); referral codes; KOL dashboard in admin (visits → planner use → install → 7-day active, by creator); public `/media-kit` page with live aggregate stats (users, sessions, top stations) for pitching creators.
- **Campaign builder** (admin): build UTM links + QR codes (SVG/PNG download), stored in `campaigns` table; campaign performance view.
### 8e. Experiments
- `experiments` table (key, variants, weights, active); server-assigned sticky bucket (cookie); `experiment_exposure` event; results view in admin (conversion = planner_query / install / newsletter by variant with simple significance note). First experiment: landing hero headline + CTA.
### 8f. Voice of customer
- Feedback widget (rating + category + optional text → Neon only, never to GA/Meta) and NPS prompt (after 3rd visit, max once/30 days). Newsletter signup (email stored in Neon with consent timestamp; double opt-in deferred if no email provider env `RESEND_API_KEY` — then just store).
### 8g. Microsoft Clarity
- `NEXT_PUBLIC_CLARITY_ID`, loads only with analytics consent, masking strict.
### 8h. Admin dashboard `/admin`
- Overview: DAU/WAU/MAU, new vs returning, sessions, avg engaged time, top pages/stations/journeys, referrers/UTM, country/city, device/standalone split, time-of-day × weekday heatmap, retention cohorts (weekly), funnel (landing → prediction_view → planner_query → install), Web Vitals p75, prediction accuracy, API latency p50/p95, public submissions queue, campaigns, KOLs, experiments, ads, feedback/NPS. Date range picker. CSV export per table. All server-side SQL aggregates (indexed), no external chart lib heavier than necessary (SVG charts ok).
### 8i. Ads inside the app (publisher side) — see `docs/ads-setup.md`
- Same slots for two systems. Placements: `station` (below the board), `station_sponsored` (dedicated "Sponsored" block, house only), `planner` (below results), `landing` (between sections). **Never** on owner Home, admin, `/add`, settings or sign-in. Fixed 300 px reserved height (no CLS), loaded only when near the viewport.
- **Google AdSense** behind `NEXT_PUBLIC_ADSENSE_CLIENT` (`ca-pub-…`) + `NEXT_PUBLIC_ADSENSE_SLOT_STATION|_PLANNER|_LANDING`: script only after consent (Consent Mode v2 basic: nothing on deny/undecided); marketing consent → personalised, analytics-only → `requestNonPersonalizedAds=1`; never for signed-in owner/analyst (invalid-traffic policy). Unfilled after 2.5 s → house ad. `/ads.txt` serves `google.com, pub-<id>, DIRECT, f08c47fec0942fa0` when set, else 404.
- **House ads** (Meta Audience Network doesn't serve mobile web, so Meta-style units are simulated): tables `ad_campaign` (slug, name, advertiser, objective awareness/traffic/conversion, status, start/end, daily budget SGD, bid model CPM|CPC, bid, targeting jsonb: stations, lines, languages, time bands, devices), `ad_creative` (format `meta_feed|meta_story|google_display|google_search_text`, headline, primary text, description, image URL or uploaded data URL ≤ 200 KB, CTA, destination, A/B weight, status, seed `ref`), `ad_event` (impression|viewable|click, creative, campaign, format, placement, device id with consent, session, internal flag).
- Serving (`src/lib/ads/select.ts`): eligible by status/dates/contextual targeting → pacing (stop when simulated spend ≥ daily budget, today SGT, non-internal) → frequency cap 3 impressions per campaign per session → campaign weighted by effective CPM (CPC × assumed 1 % CTR) → creative by A/B weight.
- Rendering: each format drawn like its platform's native unit, labelled "Sponsored"/"Ad"/"廣告". Tracking: impression on render, viewable at ≥ 50 % for ≥ 1 s, click via `/api/ads/click?c=&p=` (logs, then 302 with `utm_source=mrt_house&utm_medium=<format>&utm_campaign=<slug>&utm_content=<creative id>`); GA4 `ad_impression`/`ad_viewable`/`ad_click` (`creative_id, format, placement, campaign`) through `track()`.
- Admin → Ads: campaign + creative forms with live preview per format; report by campaign/creative/format/placement (impressions, viewable %, clicks, CTR, simulated spend, effective CPM/CPC, post-click conversions in the same session: planner_query, app_installed, newsletter_signup), CSV export.
- Seed `scripts/seed-ads.ts` (`pnpm ads:seed`, idempotent, run by Hermes): "Install MRT Time" (meta_story + google_display), "Join the newsletter" (meta_feed), "Read the accuracy report" (google_search_text). Self-promotional only.
- Sandbox: synthetic `ad_impression`/`ad_viewable`/`ad_click` with per-format CTR (search > feed > story > display) and AdSense-like `ad_revenue` on 40 % of impressions.

## 9. Marketing surfaces
- Landing `/` for visitors (owner sees personal commute home), `/station/[slug]` SEO pages (live board with inline reading entry, exits, nearby, FAQ), `/add`, `/accuracy`, `/media-kit`, `/about`, `/privacy`, `/terms`. Metadata, sitemap.xml, robots.txt, OG images (`next/og`), JSON-LD. Bilingual **EN / 繁體中文** (`/zh-Hant/...` or locale cookie; language as GA dimension); all UI strings via a dictionary.
- Share button (Web Share API) with UTM.

## 10. PWA & UX
- Installable, standalone, safe areas, 100dvh, offline last-snapshot render.
- Consent banner is a compact bottom sheet; while shown it publishes its height (incl. `env(safe-area-inset-bottom)`) as `--consent-h` and the page pads its bottom by that much, so no button or card is hidden under it. Floating buttons sit above it.
- Navigation tabs (site + admin) show the current page (`aria-current="page"` + filled pill); the mobile tab row scrolls sideways with no visible scrollbar and keeps edge padding.
- Admin: KPI labels have a fixed two-line height; empty charts show "No data for this range" over faint axes; the selected range is spelled out next to the date inputs ("7 Oct – 3 Nov 2026" / "2026年10月7日至11月3日").
- `pnpm smoke <baseUrl>`: browser-free post-deploy check of pages and APIs. Dark MRT-board look with official line colours, big countdowns, springy but calm motion. Asia/Singapore time everywhere. "min" units.
- Version on Home (small footer near the top: under the hero for visitors, under the logging buttons for the owner) and at the top of Settings: `v<pkg> · <sha> · <SGT build time>`; update banner via `/api/version` (no-store) on open, visibilitychange, every 5 min.
- Web Push (home-screen PWA): "leave now" from planner (QStash schedule, `QSTASH_TOKEN`), disruption alerts for saved journeys. No-op without env.
- Link to `bus.91208274.xyz` when a line on the journey has an alert.

## 11. Data seeding
- `scripts/seed.ts` reads `private/seed.json` (gitignored, owner data: observations, trips, profile) and upserts into DB for the owner email. Repo ships only synthetic fixtures for tests.

## 12. v2.0 overview
The owner's words: *"Should let me input time of boarding the train, this is the best: e.g. just now 10:14 I boarded Tiong Bahru → Pasir Ris, and 10:17 boarded Outram → Bayshore."* A boarding (or getting off) time is an exact sighting of a real train at that platform — stronger evidence than a board countdown. v2.0 builds on that: §13–§19. Plain wording everywhere (never "headway", "anchor", "observation", "kind" in the UI).

## 13. "I boarded" / "Got off" with an editable time (owner + public)
- Big **I boarded** / **Got off** buttons on owner Home, under every direction on station pages, and on `/add` (after picking the direction).
- Time chips: **Now · −1 · −2 · −5 min · Pick time** (SGT time picker; a picked time later than now means yesterday; at most 12 h back). Default Now; resets to Now after each tap. Shows "at HH:MM".
- Station + direction: preselected from the current journey step (owner Home) or the station card; "You're at Tiong Bahru?" GPS chip (§17); one tap to change (platform picker: search EN/中文/code → direction buttons named like the board).
- Owner: stored as a trip event (`board` / `alight`, existing `trip_event` table) **and** a train sighting linked to it. Public: `POST /api/sightings` `{ station, direction, kind: boarded|alighted, at }` → sighting with the board-reading rules: rate limit 10/hour per device + daily IP hash (shared bucket), approved when within ±2 min of a train already known at that platform (approved readings/sightings, here or propagated, recorded within 30 min), else pending → **Admin → Submissions** ("Boardings to review").
- Undo toast 10 s (`DELETE /api/sightings?id=` own device/network ≤ 2 min, or `?clientId=` for the owner; owner Home uses `DELETE /api/trip-events?clientId=`). After saving, the station board re-fetches and the owner's departures recompute at once.

## 14. Today's trip timeline (owner)
- On Home (collapsible, open once something is logged) and `/me`: today's taps in order — time, step, station, line chip, direction (board name).
- Between taps, the minutes **waited** (At platform → Boarded), **on the train** (Boarded → Got off), **changing trains** (Got off → Boarded/At platform at the same station; 0 min is real), **walking** (everything else); gaps > 3 h are separate trips. Day totals on top.
- Edit a time (same chips/picker), delete (confirm), **add a step I missed** (step, platform + direction when relevant, time). `GET/POST/PATCH/DELETE /api/trip-events` (owner only). The linked sighting follows every change (`train_sighting.trip_event_id`, unique, `ON DELETE CASCADE`); the accuracy check of a moved boarding is recomputed.

## 15. Train sightings + propagation along the line
- **Train sighting** = `{ platform, line, direction, at, kind: board_reading | boarded | alighted, source: owner | public | hermes, status }`. Boardings/getting off are stored in the additive table `train_sighting` (migration `0002_train_sightings`); board readings imply sightings (`capturedAt + minutes`) derived on the fly from `observation` (existing readings keep working unchanged).
- `/api/ingest` `board` / `alight` trip events create sightings (`source = hermes`). `scripts/backfill-sightings.ts` (`pnpm sightings:backfill`, idempotent) creates them for trip events logged before v2.0.
- **Propagation:** a sighting at station X (direction D, time t) is the same train at every other stop of D's path at t ± the cumulative ride minutes (per-hop times, §3). Spread: exact up to 2 stops away, then ±1 min per 4 further stops. Stops at the terminal; a board reading whose destination is an early terminal (Springleaf) stops there. Where a direction's paths split or merge (Circle Line at Promenade) the train is only placed where every path agrees.
- Same train seen twice (within 1 min or its spread) counts once, keeping the closest sighting.
- Predictions use propagated sightings as same-day anchors: the 10:14 Tiong Bahru `TO_EAST` boarding gives Outram Park 10:17, Tanjong Pagar 10:19. Reasons: "A rider got on or off a train here N min ago" / "From a train seen at Tiong Bahru N min ago"; a far sighting shows as "≈HH:MM ±N".

## 16. Predictor v2 + "Trains seen today"
- Order: (1) same-day trains known at the platform (readings here, sightings here or propagated; recorded ≤ 90 min ago, train ≤ 60 min ahead; gaps filled by the usual gap) → (2) learned band → (3) v1 rules while there are too few days (v0 clock repeat outside unstable windows, else a range by the usual gap).
- **Learning** per platform/direction, day type (weekday / Saturday / Sunday & public holiday — `PUBLIC_HOLIDAYS` data) and 30-min band, from all known trains (spread ≤ 1 min) on earlier days: the usual gap (median; gaps spanning several trains folded back) and whether clock times **repeat**: the phase of the trains within the gap is compared with the previous day that has data; ≤ 1 min across ≥ 3 days → "repeats" (project the learned clock times, "Trains came at the same times on N recent days"), else "drifts" (range). This replaces the hand-set unstable window as the default; **admin-edited windows still force ranges** (admin override).
- Station page: **Trains seen today** per direction (newest first, ≤ 12): time + how we know (someone got on/off here · shown on this board · seen at another station, with ± when estimated).
- `/accuracy` uses sightings as ground truth: for every approved boarding, replay the prediction from 2 min before using only what was known then (never the boarding itself), score the nearest predicted train (±1 min = hit); by line, time band and station, with usual minutes off and how many were only a range.

## 17. GPS nearest station
- Browser geolocation, asked on first use with a plain explanation ("It stays on this phone: never saved, never sent"). Coordinates are used once on the device against `STATIONS` coordinates and dropped; only the choice ("use my location") is remembered (`localStorage mrt_geo`). If location was already allowed, the suggestion appears quietly.
- "You're at Tiong Bahru?" chip on owner Home (platform picker), `/add` (station step) and wherever the platform picker appears; **Near me** sort on `/stations`. Works without permission (journey step / last used / search).
- Analytics: `geo_suggest_shown` / `geo_suggest_accepted` with the station slug only.

## 18. Every MRT station (public)
- 146 open stations (Nov 2026) with codes, English and Traditional Chinese names, coordinates, running order, terminals/directions and interchange walks (§3). Unopened numbers are skipped (NS6, NE2, CC18, TE10, TE21; DT36/37 and TE30/31 open late Dec 2026).
- Circle Line after Stage 6: Marina Bay CC33 / Bayfront CC34; modelled as Dhoby Ghaut ↔ Prince Edward Road (via HarbourFront) plus Prince Edward Road → Marina Bay → Bayfront → Promenade (board destinations of the loop trains to be confirmed — estimate, see `docs/data-sources.md`).
- Station pages, `/stations` (by line, search, Near me), sitemap, planner routing (≤ 2 changes, incl. branch changes at Tanah Merah / Promenade / Prince Edward Road), board entry and sightings work for every station. v1 slugs/URLs unchanged. Stations without a hand-set forecast area use the nearest data.gov.sg forecast area.
- Sources: Wikidata (CC0) for coordinates and Chinese labels; LTA station codes (facts); a few coordinates entered by hand. `cheeaun/sgraildata` was not used (no licence).

## 19. Commute stats (owner, `/me/stats`, linked from Home and `/me`)
- From trip events only: door → desk and desk → door per trip (only when both ends are logged — never invented), waits per platform, change times at interchanges (Outram Park first), ride times per leg, week-by-week trend, by weekday, **best time to leave** (lowest median door → desk by 10-min leave slot with ≥ 3 trips, else "Not enough trips yet").
- Hand-written SVG charts (no chart library); empty states in plain words. `stats_view` event (`trips` count only).

## 20. Analytics additions (v2.0)
`boarded_logged`, `alighted_logged` (`station, line, direction, minutes_back, user_type, status?`), `timeline_edit` (`action, kind`), `stats_view` (`trips`), `geo_suggest_shown` / `geo_suggest_accepted` (`station` slug, `surface`). No coordinates, no free text. See `docs/analytics.md`.

## 21. Backlog (next version)
- iPhone Shortcut logging (owner declined for now).
- Cross-border JB trips (owner declined for now).
