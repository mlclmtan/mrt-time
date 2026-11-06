# Practice sandbox (synthetic GA4 data)

A **separate** GA4 property filled with clearly synthetic users so you can practise GA4 (reports, Explorations, audiences, cost import, BigQuery) on realistic-looking volumes without touching production data.

Code: `src/lib/sandbox/generator.ts`, `sender.ts`, `run.ts`, `cost.ts`, `scripts/sandbox-seed.ts`, `scripts/sandbox-cost.ts`, `src/app/api/cron/sandbox/route.ts`, `vercel.json`.

## Guarantees

- **Separate property only.** `assertSandboxTarget()` (`sender.ts`) throws `SandboxTargetError` unless `GA_SANDBOX_MEASUREMENT_ID` is a well-formed `G-…` id **and** differs (case-insensitive) from every production id it knows: `NEXT_PUBLIC_GA_MEASUREMENT_ID` and `GA_PRODUCTION_MEASUREMENT_ID`. It runs before any request is made. If you load GA4 through GTM only, **set `GA_PRODUCTION_MEASUREMENT_ID`**, otherwise the guard has nothing to compare against.
- **Always labelled.** Every event carries `data_source=synthetic`; `sendPayloads()` re-stamps it on every event just before sending, whatever the generator produced. Each payload also sets user properties `data_source=synthetic` and `persona`.
- **Never in `event_log`.** The sandbox never writes analytics rows; it only logs run summaries to `sandbox_run`.
- **Synthetic URLs.** `page_location` uses `https://mrt.example/…`, not the real domain.
- Tests in `src/lib/analytics/analytics.test.ts` ("practice sandbox"): sending to the production id is rejected with zero fetch calls (also lower-case); sends to the sandbox id never include the production id; every day has 200–600 users, ≤ 25 events per request, ≤ 25 params per event, valid event names, `data_source=synthetic` on every event, and is deterministic; events older than 72 h are dropped; the cost CSV has no `utm_term`/`utm_content`.

## Setup

1. GA4 → **Admin** → **Create** → **Property**: name `MRT Time PRACTICE (synthetic)`, time zone Singapore, currency SGD.
2. **Web** stream, URL `https://mrt.example`, name `synthetic`. Turn **Enhanced measurement off** (nothing loads a tag on this stream anyway). Copy the `G-…` id.
3. In the stream → **Measurement Protocol API secrets** → **Create** → nickname `sandbox` → copy the secret value (verify the menu label in the UI; you may need to acknowledge the user-data terms first).
4. Set env vars (Vercel Production, and locally for the seed script):

| Var | Value |
|---|---|
| `GA_SANDBOX_MEASUREMENT_ID` | `G-SANDBOXXX` (the practice id) |
| `GA_SANDBOX_API_SECRET` | the MP secret |
| `CRON_SECRET` | long random string (`openssl rand -base64 32`); Vercel sends it as `Authorization: Bearer …` to the cron |
| `GA_PRODUCTION_MEASUREMENT_ID` | production `G-…` id if you use GTM only |
| `DATABASE_URL` | optional; enables the `sandbox_run` log |

5. Register custom definitions in the **practice** property (Admin → Data display → Custom definitions), all from [ga4-setup.md](ga4-setup.md#4-custom-definitions) plus:

| Name | Scope | Parameter / property |
|---|---|---|
| Data source | Event | `data_source` |
| Persona | Event | `persona` |
| Persona (user) | User | `persona` |
| Data source (user) | User | `data_source` |
| Page type | Event | `page_type` |

(Same parameter name in two scopes: verify in the UI that GA4 accepts both; if not, keep the event-scoped one.)

6. Backfill, then let the cron grow it (next sections).

## What gets generated

Deterministic per date (seeded PRNG), so re-running a date produces the same users and events.

### Volume and seasonality

- New users per SGT day: **130–219 on weekdays, 80–139 on Saturday/Sunday**.
- Returning users: each user from the previous 14 days returns with probability `min(0.9, 0.6 × returnRate × 0.85^(days_ago−1) × weekendBoost(if weekend) × 1.6(if installed))`.
- Total visitors per day: 200–600 (enforced by test).
- Visit time: daily commuters on weekdays peak around 07:30, 08:20, 17:50, 18:25; everyone else around 11, 13, 15, 19, 21 h; ±1 h jitter, clamped to 05:30–23:30 SGT. One session per visit (`session_id` = visit start in seconds), with `engagement_time_msec` on every event.

### Personas

| Persona | Weight | Weekend boost | Return rate | Install rate |
|---|---|---|---|---|
| `daily_commuter` | 40 | ×0.3 | 0.55 | 14 % |
| `tourist` | 15 | ×1.6 | 0.10 | 2 % |
| `student` | 20 | ×0.6 | 0.35 | 8 % |
| `weekend_user` | 13 | ×2.5 | 0.20 | 4 % |
| `kol_referred` | 12 | ×1.0 | 0.25 | 10 % |

### Acquisition (campaigns)

`kol_referred` users always come from a KOL row; everyone else from the non-KOL rows by weight.

| source / medium | `utm_campaign` | `utm_id` | Weight |
|---|---|---|---|
| google / cpc | `search-mrt-times` | `gads-001` | 18 |
| meta / paid_social | `reels-commute` | `meta-101` | 14 |
| tiktok / paid_social | `tt-next-train` | `tt-201` | 10 |
| trainfan / kol | `kol-trainfan` | `kol-301` | 7 (KOL only) |
| sgcommuter / kol | `kol-sgcommuter` | `kol-302` | 5 (KOL only) |
| google / organic | `(organic)` | `organic` | 30 |
| newsletter / email | `weekly-tips` | `nl-401` | 6 |
| (direct) / (none) | `(direct)` | `direct` | 10 |

### Devices and geo

| Device | OS | Browser | Screen | Weight |
|---|---|---|---|---|
| mobile | iOS 18.6 | Safari 18.6 | 393x852 | 48 |
| mobile | Android 15 | Chrome 141.0 | 412x915 | 37 |
| desktop | Windows 11 | Chrome 141.0 | 1920x1080 | 9 |
| desktop | Macintosh 15.6 | Safari 18.6 | 1512x982 | 4 |
| tablet | iOS 18.6 | Safari 18.6 | 820x1180 | 2 |

Geo (`user_location`): Singapore `SG-01` 88, Kuala Lumpur `MY-14` 5, Taipei `TW-TPE` 4, Hong Kong `HK-HCW` 3, with UN M49 subcontinent/continent codes. Taipei/Hong Kong users get `language=zh-Hant` (`device.language=zh-tw`), others `en` (`en-sg`).

### Funnel per visit

1. `page_view` — `page_location` with UTM params + `utm_id` for new users (`/k/<handle>` for KOL users, `/` otherwise), `page_type` `kol` or `landing`.
2. New KOL users: `kol_landing` (`code_used` 1 in 30 % of cases, sent as 1/0).
3. New paid/KOL/email users: `campaign_landing` (`source`, `medium`; `campaign` is on every event).
4. New users: `experiment_exposure` `landing_hero`, `control` or `countdown` 50/50.
5. Returning installed users: `standalone_open`.
6. 75 % of visits: `station_view` + `prediction_view` (`confidence` high/medium/low), then `planner_query` with probability 0.38 × 1.2 (countdown) × 1.4 (commuter). New installers then get `install_prompt_shown` + `app_installed`.
7. Ads on 85 % of those visits (one station-page slot): 40 % AdSense-like fills (`ad_source=adsense`, `format=google_display`, `campaign=adsense`, `ad_revenue` = eCPM S$1.50–4.00 / 1000 with `currency=SGD`) and 60 % house creatives with per-format viewability and CTR — `google_search_text` 3.5 % CTR, `meta_feed` 1.2 %, `meta_story` 0.8 %, `google_display` 0.4 % — each as `ad_impression` → `ad_viewable` → `ad_click` with `creative_id`, `format`, `placement`, `campaign`. Practise: CTR and viewability by format, revenue per 1,000 sessions, and whether ad clicks lead to `planner_query`.
8. Extras in those visits: `share` 5 %, `newsletter_signup` 2 %, `feedback_submit` 3 % (rating 3–5).

A/B effect built in: `countdown` lifts planner rate ×1.2 and install rate ×1.15, so the experiment should show a winner given enough days.

Every event carries: `session_id`, `engagement_time_msec`, `data_source`, `language`, `user_type=visitor`, `standalone` (`yes` for returning installers), `persona`, `campaign`, and `kol_handle` for KOL users. Differences from production: `station` is a slug on `prediction_view` too, `direction`/`basis` are not sent, and `install_prompt_shown`/`app_installed` use `android` for non-iOS devices.

## Running it

### Backfill: `pnpm sandbox:seed`

Reads `GA_SANDBOX_*` from your local env files (via `dotenv`), generates the complete days 3, 2 and 1 days ago (SGT), drops every event older than **72 h − 30 min** or in the future, and sends the rest. Prints one line per day: users, events, requests, status.

```bash
pnpm sandbox:seed --dry-run   # generate + count only; nothing sent, nothing logged
pnpm sandbox:seed             # send to the practice property
```

No duplicates: with `DATABASE_URL` set, every sent day is logged in `sandbox_run`, and both the seed and the cron skip any day already logged as `ok`/`partial` (shown as `skipped`). Without a database there is no log, so don't run the seed twice in that case.

### Daily cron

`vercel.json`: `30 16 * * *` UTC = **00:30 SGT**, `GET /api/cron/sandbox`. It sends **yesterday** (SGT) only, about 24.5–48 h old, inside the MP window. Returns `401` without the right bearer token and `{"skipped":"sandbox not configured"}` if the sandbox env is missing or points at production.

Manual trigger:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://mrt.91208274.xyz/api/cron/sandbox
```

Vercel cron behaviour (production deployments only, plan limits): verify in the Vercel UI under Project → Settings → Cron Jobs.

### Run log: `sandbox_run`

| Column | Meaning |
|---|---|
| `ran_at` | when the run happened |
| `mode` | `cron` or `script` |
| `day` | SGT date generated |
| `users`, `events`, `requests` | visitors generated, events accepted (2xx), HTTP requests made |
| `status` | `ok`, `partial` (some requests failed) or `error` (e.g. guard refused) |
| `error` | first 200 chars of the error |

```sql
select ran_at, mode, day, users, events, requests, status, error
from sandbox_run order by ran_at desc limit 20;
```

Dry runs are not logged.

## Measurement Protocol notes

| Topic | What applies |
|---|---|
| Endpoint | `POST https://www.google-analytics.com/mp/collect?measurement_id=G-…&api_secret=…` (returns 2xx even for bad payloads) |
| Validation | Same body to `/debug/mp/collect`; the response lists `validationMessages`. `sendPayloads()` has a `debug` option, but no CLI flag exposes it; use curl (below). |
| Limits | 25 events/request (generator chunks at 25), 25 params/event, event and param names ≤ 40 chars, param values ≤ 100 chars, 25 user properties (names ≤ 24, values ≤ 36 chars), body < 130 kB |
| Backdating | Up to **72 h**. In the default (relaxed) validation, older timestamps are clamped to 72 h ago; with ENFORCE_RECOMMENDATIONS they're rejected. The generator drops anything older than 72 h − 30 min instead. |
| Sessions | `session_id` + `engagement_time_msec` params are sent so events group into sessions and count as engaged. |
| Reserved | Don't send names starting `_`, `firebase_`, `ga_`, `google_`, or reserved events such as `session_start`, `first_visit`, `user_engagement`. |
| `user_location` | Supported: `city`, `region_id` (ISO 3166-2), `country_id`, `subcontinent_id`, `continent_id` (UN M49). Sent. |
| `device` | Supported: `category`, `language`, `screen_resolution`, `operating_system`, `operating_system_version`, `model`, `brand`, `browser`, `browser_version`. We send all but `model`/`brand`. |
| `user_agent` | Added to MP in 2025, exact shape unverified. Not sent. |
| Per-event `timestamp_micros` | The generator sets `timestamp_micros` on each event (not at request level). Verify with the validation endpoint that it is accepted. |
| Campaign attribution | **Unverified for web streams.** Documented `campaign_details` is for app streams. We send UTMs inside `page_location` plus custom params `campaign`, `persona`, `data_source`. Expect Session source/medium to show `(not set)` or `(direct)` in standard acquisition reports. Use the custom **Campaign (app)** dimension for campaign analysis. |

Validate a sample payload:

```bash
curl -s -X POST \
  "https://www.google-analytics.com/debug/mp/collect?measurement_id=G-SANDBOXXX&api_secret=YOUR_SECRET" \
  -H 'content-type: application/json' \
  -d '{
    "client_id": "123456.1793600000",
    "user_properties": { "data_source": { "value": "synthetic" } },
    "user_location": { "city": "Singapore", "region_id": "SG-01", "country_id": "SG", "subcontinent_id": "035", "continent_id": "142" },
    "device": { "category": "mobile", "language": "en-sg", "operating_system": "iOS", "browser": "Safari" },
    "events": [{ "name": "planner_query",
                 "params": { "session_id": "1793600000", "engagement_time_msec": 30000, "data_source": "synthetic",
                             "journey_type": "public", "mode": "depart", "transfers": 1 } }]
  }'
```

An empty `validationMessages` array means the payload is valid. Debug hits are not recorded in reports.

## Synthetic ad cost import

```bash
pnpm sandbox:cost --days 14 --out sandbox-cost.csv   # 1–90 days, default 7; --currency SGD (default)
```

Writes one row per paid acquisition per date (`google/cpc`, `meta/paid_social`, `tiktok/paid_social`, `trainfan/kol`, `sgcommuter/kol` → 5 rows per day), for the last N SGT dates **ending yesterday** (cost import rejects future dates). Without `--out` it prints to stdout. Don't commit the CSV.

| Column | Example | Notes |
|---|---|---|
| `utm_source` | `meta` | required |
| `utm_medium` | `paid_social` | required |
| `utm_campaign` | `reels-commute` | recommended |
| `utm_id` | `meta-101` | recommended (campaign id) |
| `date` | `2026-11-02` | `YYYY-MM-DD`, not in the future |
| `currency` | `SGD` | required when cost is given |
| `impressions` | `14321` | daily |
| `clicks` | `171` | daily |
| `cost` | `61.25` | daily, 2 decimals |

`utm_term`/`utm_content` are not allowed in cost import and are not written. Each source+medium+campaign+date appears once per file.

Upload (practice property):

1. Admin → **Data collection and modification** → **Data import** → **Create data source**.
2. Name `synthetic cost`, data type **Cost data** → **Manual CSV upload** → choose `sandbox-cost.csv`.
3. Map: Campaign ID ← `utm_id`, Campaign name ← `utm_campaign`, Source ← `utm_source`, Medium ← `utm_medium`, Date ← `date`, Currency ← `currency`, Impressions/Clicks/Cost ← same names (verify field labels in the UI).
4. **Import**. Data can take up to 24 h to appear. Re-uploading the same keys overwrites them, so you can refresh daily with a new 14-day file.
5. Find it under the non-Google cost / campaign reports (verify the report name in the UI). Because MP-sent sessions may not get source/medium (see above), cost may not line up with sessions. That mismatch is a useful exercise in itself; compare against the **Campaign (app)** custom dimension instead.

## Practice exercises

1. Confirm `data_source = synthetic` on every event in a free-form exploration, and build a comparison that would exclude it.
2. Funnel exploration `page_view → prediction_view → planner_query → app_installed`, broken down by `Persona`; which persona converts best?
3. Experiment readout: `Variant` × `planner_query` users. Compute the lift and run a two-proportion z-test by hand; compare with the built-in A/B effect (×1.2).
4. Weekday vs weekend: free form with "Day of week name" × "Hour"; find the commuter peaks.
5. Cohort exploration (weekly, return on `prediction_view`) by `Persona`; explain why installers retain better (×1.6 return boost).
6. Build the four audiences from [ga4-setup.md](ga4-setup.md#8-audiences) here first and watch membership grow.
7. Upload 14 days of cost, then calculate cost per `planner_query` by `Campaign (app)` in a spreadsheet or BigQuery.
8. KOL analysis: compare `kol-trainfan` vs `kol-sgcommuter` on users, planner rate, `code_used`.
9. Geo/language: share of `zh-Hant` users by city; test a "Taiwan + Hong Kong" segment.
10. Link the practice property to BigQuery and rewrite exercise 2 in SQL.
