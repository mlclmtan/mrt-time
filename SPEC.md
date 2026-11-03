# MRT Time — v1.1 spec

Public web app (PWA) that predicts Singapore MRT train arrivals from timed platform-board readings (no operator live-arrival feed exists), plans door-to-door commutes with transfers, and doubles as a **real marketing/analytics practice product** (GA4, GTM, ads tracking, KOL tracking, SEO, experiments).

Live at `mrt.91208274.xyz`. Repo is PUBLIC: never commit personal data (home/office addresses, emails, the owner's real observations/trip logs). Personal data lives only in the DB, seeded from a gitignored file.

## 1. Stack
- Next.js 16 (App Router) on Vercel Hobby, TypeScript, Tailwind 4, Drizzle + Neon Postgres (`@neondatabase/serverless`), Better Auth (Google sign-in primary, passkey optional), zod, vitest. pnpm.
- Sibling reference (read-only): `~/code/bus` (same stack, auth allowlist, PWA, version banner, push, QStash, multi-leg trips with train legs).
- All third-party IDs/keys via env; every integration is a no-op when its env is unset. `pnpm build` passes with no env.

## 2. Users & access
- **Public (no login):** station boards, journey planner, landing/SEO pages, accuracy page, submit a board reading (crowdsourced, rate-limited).
- **Signed-in owner (`ALLOWED_EMAILS`):** personal commute (saved places + journeys), one-tap logging, admin dashboard, moderation of public readings, campaign/KOL/experiment management.
- **Analysts (`ANALYST_EMAILS`, optional):** read-only access to `/admin` analytics (for a marketing collaborator). Unset by default.

## 3. Network data (static, in repo)
- Lines/stations needed now: EWL (EW15 Tanjong Pagar, EW16 Outram Park, EW17 Tiong Bahru, EW18 Redhill + terminals EW1 Pasir Ris, EW29 Joo Koon, EW33 Tuas Link), TEL (TE14 Orchard, TE17 Outram Park, TE18 Maxwell, TE19 Shenton Way + terminals TE1 Woodlands North, TE29 Bayshore), NEL (NE3 Outram Park + NE1 HarbourFront, NE18 Punggol Coast). Station order/adjacency per line so ride times and "which direction" are computable. Easy to extend to every station later (data file structure must allow full network).
- Line colours (official), service hours (approx 05:30–00:30), directions per line keyed by terminal (e.g. EWL `TO_EAST`→Pasir Ris, `TO_WEST`→Joo Koon/Tuas Link; TEL `TO_BAYSHORE`, `TO_NORTH`; NEL `TO_HARBOURFRONT`, `TO_PUNGGOL`).
- Inter-station ride minutes (observed: EW17↔EW16 3, TE17↔TE19 3, EW15→EW17 5) with a default of 2 min/stop.
- Interchange transfer minutes (estimates, platform to platform): Outram Park EW16↔TE17 **2** (observed 1–2, median 2), NE3↔EW16 **3**, NE3↔TE17 **4**. Default for an interchange without a figure: 3. Never above 4 unless a transfer is known to be long.

## 4. Observations & prediction engine (`src/lib/predict/`, pure, tested)
- **Observation** = board reading: station, line, direction, destination, capturedAt (SGT), minutes shown for next / next-next / optional 3rd train, source (owner | public | hermes), status (approved | pending | rejected).
- Derived: actual arrival clock times; headway = gap between shown trains.
- **Trip events** = owner logs: board / alight / at_platform / tap_in / tap_out / door / desk / etc., timestamp = the moment of the tap (never a server-delayed time).
- Prediction for (station, direction, now):
  1. **Same-day anchor:** an approved reading today at that platform within 90 min → project by its headway (high confidence).
  2. Else **time-band headway model:** LTA-published fallback peak (weekday 07:00–09:00, 17:00–19:00) 2–3 min, off-peak 5–7 min, overridden by the median observed headway for that line/direction/time band once ≥2 readings exist (observed so far: TEL 6 min, EWL 4–6 min off-peak).
  3. **Historical clock-time repeat** (anchor from another day at a similar time-of-day/day-type, as in v0 `lib/predict.js`) is used ONLY outside unstable windows. **Weekday 09:15–10:30 is marked unstable** (owner observed clock times don't repeat day to day): show "every ~N min" + wait range, never exact clock times from other days. The unstable-window list is data, editable in admin.
  - Output: next arrivals (clock + countdown) or a range, headway, confidence (high/medium/low) + plain reason ("from a reading 12 min ago" / "typical gap at this hour").
- **Accuracy tracking:** when the owner logs `board` at a platform, store the prediction that was shown/computed for that moment; compute hit rate (predicted train within ±1 min) per line/station/time band. Public `/accuracy` page.

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
- Home screen big buttons in context: "At platform", "Boarded", "Got off", "Tap out", "Arrived" — journey-aware (knows the next expected step), timestamp at tap, undo within 10 s.
- Board reading entry: station + direction preselected from journey context, number pad for minutes (up to 3 trains), save. Optional photo is NOT stored (photos live in Notion).
- `POST /api/ingest` with bearer `INGEST_TOKEN` so Hermes can post readings/events it extracts from photos sent in chat.
- Public submission form (station/direction/minutes, no login): rate limit per device+IP hash (e.g. 10/hour), status `pending` unless consistent (±2 min) with an approved reading/prediction in the same 30-min window → auto-approve; else owner moderates in admin.

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
- Overview: DAU/WAU/MAU, new vs returning, sessions, avg engaged time, top pages/stations/journeys, referrers/UTM, country/city, device/standalone split, time-of-day × weekday heatmap, retention cohorts (weekly), funnel (landing → prediction_view → planner_query → install), Web Vitals p75, prediction accuracy, API latency p50/p95, public submissions queue, campaigns, KOLs, experiments, feedback/NPS. Date range picker. CSV export per table. All server-side SQL aggregates (indexed), no external chart lib heavier than necessary (SVG charts ok).

## 9. Marketing surfaces
- Landing `/` for visitors (owner sees personal commute home), `/station/[slug]` SEO pages (live board, exits, nearby, FAQ), `/accuracy`, `/media-kit`, `/about`, `/privacy`, `/terms`. Metadata, sitemap.xml, robots.txt, OG images (`next/og`), JSON-LD. Bilingual **EN / 繁體中文** (`/zh-Hant/...` or locale cookie; language as GA dimension); all UI strings via a dictionary.
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

## 12. Backlog (next version)
- (empty)
