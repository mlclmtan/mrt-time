# Analytics

How MRT Time measures usage: what is collected, where it goes, and how the admin metrics are computed. Setup guides for the external tools are in [ga4-setup.md](ga4-setup.md), [meta-setup.md](meta-setup.md), [sandbox.md](sandbox.md) and [kol-playbook.md](kol-playbook.md).

## Architecture

```
browser ──track(name, props)──┬─► POST /api/events ──► event_log (Neon) ──► /admin aggregates
   (only with some consent)   │                   └──► Meta Conversions API (marketing consent)
                              ├─► dataLayer.push / gtag("event")  ──► GTM ──► GA4 (+ Google Ads)
                              └─► fbq(track, …, {eventID})        ──► Meta Pixel
proxy (src/proxy.ts) ── no consent at all ──► aggregate-only page_view row in event_log
Clarity ── loaded with analytics consent only (session replay/heatmaps, masking set in Clarity)
```

| Layer | Code | Notes |
|---|---|---|
| Event taxonomy + validation | `src/lib/analytics/events.ts` | `EVENT_SCHEMAS` (zod strict objects) and `envelopeSchema`. Unknown events or extra props are rejected. |
| Client transport | `src/lib/analytics/client.ts`, `src/components/analytics/analytics-provider.tsx` | Batches up to 20 envelopes, 400 ms debounce, `sendBeacon` (fallback `fetch keepalive`), flushes on `visibilitychange`. |
| Ingest | `src/app/api/events/route.ts`, `src/lib/analytics/ingest.ts` | Same-origin only, body ≤ 32 kB, ≤ 20 events per call. Rows are written in `after()` so the response is immediate. Bots (coarse UA match) are dropped. |
| Server-side anonymous hits | `src/proxy.ts` → `serverPageHitRow()` | See [Consent gating](#consent-gating). |
| GA4 / Google Ads mapping | `src/lib/analytics/mapping.ts` (`ga4Params`) | Same event names as first-party. |
| Meta mapping | `src/lib/analytics/mapping.ts` (`metaEventFor`), `src/lib/analytics/meta-capi.ts` | Pixel + CAPI, deduplicated by `event_id`. |
| Third-party tags | `src/lib/analytics/scripts.ts`, `src/components/analytics/third-party-scripts.tsx` | IDs are regex-validated (`GTM-…`, `G-…`, `AW-…`, 8–20 digit pixel, Clarity id) so env values cannot inject script. |
| Admin metrics | `src/lib/analytics/aggregates.ts` | Server-side SQL over `event_log` (indexed on `ts`, `name+ts`, `device_id+ts`, `utm_campaign+ts`). |
| Experiments | `src/lib/analytics/experiments.ts`, `src/lib/server/experiments.ts` | Sticky server-side buckets. |

If `DATABASE_URL` is unset, nothing is stored; the third-party mirrors still work if their IDs are set.

## Consent gating

Consent cookie `mrt_consent` = `v1.a<0|1>.m<0|1>.<unix-seconds>` (365 days). Missing or malformed = denied/undecided. Google Consent Mode v2 **basic**: no Google, Meta or Clarity script is injected until the visitor grants something.

| Consent state | First-party (`event_log`) | GA4 / GTM | Meta Pixel + CAPI | Clarity |
|---|---|---|---|---|
| None / undecided / rejected all | Proxy writes one `page_view` per HTML/RSC request: `aggregate_only=true`, `origin=server`, no device/session id, `page_type=other`. Client `track()` sends nothing. | Not loaded | Not loaded / not sent | Not loaded |
| Marketing only | Client events stored `aggregate_only=true` (device/session id stripped server-side) | GTM loads (if `NEXT_PUBLIC_GTM_ID`) with `analytics_storage=denied`; gtag fallback loads only the Ads id | Pixel loads; CAPI forwards mapped events | Not loaded |
| Analytics only | Full rows with device + session id | GTM, or gtag with `G-…` | Not loaded / not sent | Loaded |
| Both | Full rows | Loaded | Loaded + CAPI | Loaded |

- Consent Mode signals (`consent.ts`): `analytics_storage` ← analytics; `ad_storage`, `ad_user_data`, `ad_personalization` ← marketing. The inline bootstrap sets a `default` of all denied, then an `update` with the visitor's choice; `setConsent()` also calls `gtag('consent','update', …)`.
- Revoking analytics consent deletes the device id, session, stored UTMs and KOL handle (`forgetDevice()`).
- The proxy does not log `/admin`, prefetches, non-HTML requests, or anyone with a Better Auth session cookie (owner/analyst).
- `consent_update` is sent through `track()`, so it is only recorded when at least one category is granted; "reject all" is not logged.

### Browser storage

| Key | Where | When | Purpose |
|---|---|---|---|
| `mrt_consent` | cookie, 365 d | on choice | consent state |
| `mrt_bucket` | httpOnly cookie, 365 d | every visitor (set by the proxy) | random seed for experiment buckets; not sent to analytics |
| `mrt_lang` | cookie | language switch | locale |
| `mrt_device` | localStorage + cookie (400 d) | analytics consent | anonymous device id |
| `mrt_session` | localStorage | analytics consent | session id, 30-min inactivity |
| `mrt_utm_first`, `mrt_utm_last`, `mrt_kol` | localStorage | analytics consent | first/last touch, KOL attribution |
| `mrt_nps`, `mrt_install_dismissed`, `mrt_standalone` (sessionStorage) | browser | always | UI state only |
| `_ga*`, `_fbp`/`_fbc`, Clarity cookies | third-party tags | only after the matching consent | set by Google/Meta/Microsoft |

## Event catalogue

All props are enums, bounded numbers/booleans or slug-like tokens (`slug` = `^[a-z0-9][a-z0-9_-]{0,47}$`; `code` = platform code like `EW17`; `direction` = `TO_[A-Z]{2,20}`; `line` ∈ `EWL|TEL|NEL`). `track()` silently drops anything that fails validation.

| Event | Props | Fires when (call site) |
|---|---|---|
| `page_view` | `page_type` (`landing, owner_home, station, planner, accuracy, media_kit, about, privacy, terms, submit, settings, admin, kol, sign_in, other`), `station?` (slug) | Every client route change (`analytics-provider.tsx`); server-side aggregate row when no consent (`proxy.ts`, `page_type=other`) |
| `station_view` | `station` (slug), `line?` | Station page mount (`StationTracker`, `/station/[slug]`) |
| `journey_view` | `journey_type` (`owner_saved\|public`), `journey_key?` (slug) | Planner result for an owner saved journey (`planner.tsx`). `public` is in the schema but not emitted yet. |
| `planner_query` | `from_station`, `to_station` (slug), `mode` (`depart\|leave_by\|list`), `transfers` (0–2), `journey_type` | Successful `/api/plan` response the visitor asked for (`planner.tsx`): submit or an input change (debounced). The automatic plan on page load is **not** counted. |
| `prediction_view` | `station` (code), `line`, `direction`, `confidence` (`high\|medium\|low`), `basis` (`same_day\|historical\|band\|closed\|none`) | Each direction row on a live board, once per mount (`live-board.tsx`) |
| `prediction_feedback` | `station` (code), `line`, `direction`, `verdict` (`accurate\|early\|late`) | Tap on accurate/early/late under a prediction (`live-board.tsx`) |
| `log_reading` | `station` (code), `line`, `direction`, `trains` (1–3) | Reading saved successfully (`board/quick-entry.tsx`: station cards, owner Home, `/add`) |
| `log_trip_event` | `kind` (`door, lift_lobby, station_entrance, tap_in, at_platform, board, alight, tap_out, desk, arrived`), `station?` (code), `line?` | Owner taps a trip-step button (`owner-home.tsx`) |
| `submit_reading` | `station` (code), `line`, `direction`, `status` (`approved\|pending\|rate_limited`) | Quick-entry save result, incl. HTTP 429 (`board/quick-entry.tsx`) |
| `install_prompt_shown` | `platform` (`ios\|android\|desktop\|other`) | `beforeinstallprompt` fires (Android/desktop Chromium only) (`install-prompt.tsx`) |
| `app_installed` | `platform` | Browser `appinstalled` event (`analytics-provider.tsx`). iOS Safari does not fire it; use `standalone_open` / `standalone=yes` for iOS. |
| `standalone_open` | — | First page load per browser session in standalone display mode |
| `share` | `method` (`web_share\|copy`), `content_type` (`station\|journey\|app\|media_kit`) | Share button (`share-button.tsx`) |
| `outbound_click` | `domain` (hostname), `link_type` (`bus\|lta\|other`) | Bus-app link in a line alert banner (`live-board.tsx`) |
| `alert_view` | `line`, `status` (1–2, LTA status) | Alert banner shown, once per line per mount (`live-board.tsx`) |
| `crowd_view` | `station` (code), `line`, `level` (`l\|m\|h\|NA`) | Crowd chip data present on a platform card (`live-board.tsx`) |
| `feedback_submit` | `rating` (1–5), `category` (`accuracy, planner, design, bug, idea, other`) | After `/api/feedback` succeeds. The optional text goes to Neon only. |
| `nps_submit` | `score` (0–10) | NPS prompt submit (after 3rd visit day, max once/30 days). Comment goes to Neon only. |
| `newsletter_signup` | `double_opt_in` (bool) | After `/api/newsletter` succeeds. Email goes to Neon only. |
| `experiment_exposure` | `experiment_id`, `variant` (slugs) | Visitor landing hero mount (`ExposureTracker` in `landing.tsx`) |
| `kol_landing` | `kol_handle` (slug), `code_used` (bool, `?code=1` from `/r/CODE`) | `/k/[handle]` mount (`KolTracker`) |
| `campaign_landing` | `campaign`, `source`, `medium` (slugs) | Route change whose URL carries `utm_source`, `utm_medium` and `utm_campaign`, except `utm_medium=kol` |
| `consent_update` | `analytics`, `marketing` (bool) | Consent banner/Settings save (only if something is granted, see above) |
| `ad_impression` | `creative_id` (int), `format` (`meta_feed\|meta_story\|google_display\|google_search_text`), `placement` (`station\|station_sponsored\|planner\|landing`), `campaign` (slug) | A house ad rendered in a slot (`ads/ad-slot.tsx`). AdSense fills are reported by AdSense, not here. |
| `ad_viewable` | same as `ad_impression` | The house ad was ≥ 50 % visible for ≥ 1 s (IntersectionObserver) |
| `ad_click` | same as `ad_impression` | Tap on a house ad (opens `/api/ads/click`, which logs and 302s with UTM) |
| `web_vital` | `metric` (`LCP\|INP\|CLS\|TTFB\|FCP`), `value` (0–600000), `rating` (`good\|needs-improvement\|poor`) | `web-vitals` callbacks for LCP, INP, CLS, TTFB. FCP is allowed by the schema but not reported. |

Note the `station` prop holds a **slug** (`outram-park`) on `page_view`/`station_view`/`planner_query` and a **platform code** (`TE17`) on board events. Filter by event name when reporting on the GA4 `station` dimension.

## Envelope (context sent with every event)

`envelopeSchema` in `events.ts`. What the server does with each field:

| Field | Stored in `event_log` | Notes |
|---|---|---|
| `name`, `props` | `name`, `props` (jsonb) | Re-validated server-side |
| `event_id` | `event_id` | Random UUID per event; shared with Meta Pixel `eventID` / CAPI `event_id` |
| `device_id`, `session_id` | `device_id`, `session_id` | **Only if `consent.analytics`**; otherwise null and `aggregate_only=true` |
| `route` | `route` | Path only; query string and hash stripped (`cleanRoute`). Client rows keep any `/zh-Hant` prefix; proxy rows are locale-stripped. |
| `referrer` | `referrer` | Origin + path only (`cleanReferrer`) |
| `utm.{source,medium,campaign,content,term}` | `utm_*` | Slugged. Last-touch per device (first touch is kept in `device.first_touch`) |
| `kol_handle` | `kol_handle` | From `/k/[handle]`, remembered with analytics consent |
| `viewport` | `viewport` | `WIDTHxHEIGHT` |
| `standalone`, `language` | `standalone`, `language` | `language` ∈ `en\|zh-Hant` |
| `experiments` | `experiments` (jsonb) | e.g. `{"landing_hero":"countdown"}` |
| `consent` | not stored as a column | Decides `aggregate_only` and CAPI forwarding |
| `fbp`, `fbc` | **not stored** | Forwarded to Meta CAPI only with marketing consent |
| — (server) | `user_type` | `owner` / `analyst` / `visitor`, from the auth session, never from the client |
| — (server) | `country`, `region`, `city` | Vercel geo headers only (`x-vercel-ip-country`, `-country-region`, `-city`) |
| — (server) | `browser`, `os`, `device_type` | Coarse UA buckets; the raw UA is not stored |
| — (server) | `origin`, `aggregate_only`, `ts` | `client` or `server` |

**No IP address is stored anywhere in `event_log`.** The only IP-derived value in the app is `dailyIpHash()` (`request.ts`): SHA-256 of `IP_HASH_SALT | SGT date | ip`, truncated, used for public reading rate limits (`rate_limit`, `observation.ip_hash`). The salt rotates with the date so hashes cannot be joined across days. Set `IP_HASH_SALT`; it falls back to a constant if unset.

`device` table: one row per consenting device id with `first_seen`, `last_seen`, `first_touch`/`last_touch` (`{source, medium, campaign}`), `kol_handle` (first one wins), `installed_at` (first `app_installed`).

## GA4 mirror

The client mirrors each validated event after posting it first-party:

- **GTM** (`NEXT_PUBLIC_GTM_ID` set): `dataLayer.push({ event: <name>, ...params })`.
- **gtag fallback** (no GTM, `NEXT_PUBLIC_GA_MEASUREMENT_ID` set): `gtag('event', <name>, params)`; config uses `send_page_view:false` because the app sends its own `page_view`.

`params = ga4Params(name, props, ctx)`: every string/number/boolean prop, plus the context below.

### Custom dimensions (`GA4_DIMENSIONS`)

All are **event-scoped** event parameters. Register them as described in [ga4-setup.md](ga4-setup.md#4-custom-definitions).

| Parameter | Source |
|---|---|
| `station` | event prop (slug or platform code, see above) |
| `line` | event prop |
| `direction` | event prop |
| `journey_type` | event prop |
| `confidence` | event prop (`prediction_view`) |
| `standalone` | context: `"yes"` / `"no"` |
| `language` | context: `en` / `zh-Hant` |
| `user_type` | context: `owner` / `analyst` / `visitor` |
| `experiment_id`, `variant` | context: first active experiment assignment, added to every event except `experiment_exposure` (which carries its own) |
| `kol_handle` | event prop on `kol_landing`, else remembered KOL handle |
| `campaign` | event prop on `campaign_landing`, else the remembered last-touch `utm_campaign` |
| `traffic_type` | `internal` when `user_type` is `owner` or `analyst` (also pushed to the dataLayer / gtag config for internal sessions) |
| `data_source` | `synthetic` — **practice sandbox property only**, never sent by the production app |

Other props (`page_type`, `mode`, `transfers`, `basis`, `verdict`, `status`, `platform`, `method`, `content_type`, `metric`, `value`, `rating`, `category`, `score`, …) are also sent as parameters; register them only if you need them in standard reports.

## Meta mirror

With marketing consent only: `fbq('track'|'trackCustom', event, data, { eventID: event_id })` in the browser, and the same `event_id` sent server-side via CAPI. Mapping and dedup details: [meta-setup.md](meta-setup.md).

## Privacy guarantees

- No PII and no free text ever leaves for GA4, Meta or Clarity: event schemas cannot carry it (enforced by test), routes/referrers drop query strings, UTM values are slugged.
- Feedback text, NPS comments and newsletter emails are posted to `/api/feedback`, `/api/nps`, `/api/newsletter` and stored only in Neon (`feedback`, `nps_response`, `newsletter`). The analytics events for them carry only rating/category, score, or `double_opt_in`.
- Newsletter rows store the consent timestamp (`consent_at`).
- Meta CAPI receives only `client_user_agent`, `_fbp`, `_fbc`, the page URL (no query) and the mapped custom data. No IP, email or phone.
- Clarity loads only with analytics consent; set masking to **Strict** in the Clarity project (the newsletter email field also has `data-clarity-mask`).
- Admin CSV exports (`/api/admin/export`, whitelist `EXPORTS`) are owner/analyst only; analysts cannot export `feedback` or `nps_response` (free text).

## Admin metrics (`/admin`)

All in `src/lib/analytics/aggregates.ts`. Days and weeks are **Singapore** calendar days/weeks. Default range: last 28 days. Metrics built on `device_id` only count devices with analytics consent; counts of rows include aggregate-only rows. Owner/analyst events are **not** filtered out of these queries (filter `user_type='visitor'` in exports if needed).

| Metric | Definition |
|---|---|
| DAU (chart) | Distinct `device_id` per SGT day in range |
| DAU / WAU / MAU (tiles) | Distinct `device_id` in the 1 / 7 / 30 days ending at the range end (rolling) |
| New vs returning | Devices active in range whose first-ever event is inside (new) or before (returning) the range |
| Sessions | Distinct `session_id` in range |
| Avg engaged time | Mean of (last event − first event) per session; single-event sessions count as 0 s |
| Page views / anonymous page views | All `page_view` rows / those with `aggregate_only` |
| Top pages, stations, journeys, referrers, geo, device | Row counts of `page_view` (route, referrer host, country·city, device type·standalone), `station_view` (station), `journey_view` (journey key) |
| Top UTM | Distinct sessions (or rows when no session) per source/medium/campaign |
| Heatmap | `page_view` rows by ISO weekday × hour (SGT) |
| Weekly retention | Cohort = SGT Monday week of a device's first event; cell = distinct devices active `week_offset` whole weeks later |
| Funnel | Ordered per device: first `page_view` in range → `prediction_view` at/after it → `planner_query` at/after that → `app_installed` at/after that |
| Web Vitals | p75 of `web_vital.value` per metric |
| API latency | p50 / p95 of `api_metric.ms` per route |
| Prediction accuracy | `prediction_check`: scored vs hits per line |
| Campaign performance | Per `utm_campaign/source/medium`: distinct sessions, distinct devices, `planner_query` rows, `app_installed` rows |
| KOL funnel | See [kol-playbook.md](kol-playbook.md#5-dashboard-metrics) |
| Experiments | Per variant: devices with `experiment_exposure` in range; of those, devices with `planner_query` / `app_installed` / `newsletter_signup` after first exposure. Significance: two-proportion z-test on **planner_query** conversion of each variant vs the first variant; "Too early" below 100 exposed in total, otherwise "Significant at 95%" if p < 0.05 |
| Feedback / NPS | Count and average rating; NPS = %promoters (9–10) − %detractors (0–6) |
| Media kit (public) | Last 30 days: distinct devices, distinct sessions, all `page_view` rows, top 5 stations by `station_view` |

### Experiments

- `mrt_bucket` (random UUID, httpOnly) is set by the proxy and forwarded as `x-mrt-bucket`. Variant = FNV-1a 32-bit hash of `"<experiment_key>:<seed>"` mapped onto cumulative weights, so assignment is sticky per browser and independent per experiment.
- Active experiments come from the `experiment` table (cached 60 s) or, if empty, `DEFAULT_EXPERIMENTS`: `landing_hero` with `control` (50, "See live boards" → `/#stations`) and `countdown` (50, "Plan my trip" → `/plan`).
- Manage in `/admin/experiments` (variants as `key:weight, key:weight`).

## Adding an event

1. Add the schema to `EVENT_SCHEMAS` in `src/lib/analytics/events.ts`. Use enums, bounded numbers, booleans or the `slug`/`code` patterns. Never a free `z.string()`.
2. Update the expected list in `src/lib/analytics/analytics.test.ts` ("covers every spec event name"). The test "no event schema has an email, name or free-text field" fails if a prop name matches `email|name|text|comment|message|note|address|phone|query|search|lat|lng|ip` or if any string prop accepts a sentence or an email address.
3. Call `const { track } = useAnalytics(); track("my_event", { … })` from a client component. Types come from the schema.
4. Optional: map it to Meta in `metaEventFor()` and/or add a parameter to `GA4_DIMENSIONS`.
5. Add it to the table above, register any new dimension in GA4, and add it to the GTM trigger regex ([ga4-setup.md](ga4-setup.md#3-gtm-container)).
6. Run `pnpm test`.
