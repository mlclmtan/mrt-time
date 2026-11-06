# GA4 + GTM setup (production property)

Step-by-step admin setup for the **production** GA4 property. The practice property for synthetic data is separate: see [sandbox.md](sandbox.md). Event names, parameters and consent behaviour are defined in [analytics.md](analytics.md).

Google moves menus around often. Paths below match the GA4/GTM UI as documented at the time of writing; anything not checkable from this repo is marked **verify in the UI**.

## Env vars

| Var | Value | Effect |
|---|---|---|
| `NEXT_PUBLIC_GTM_ID` | `GTM-XXXXXXX` | Preferred. Loads GTM after consent; events are `dataLayer.push({event, ...params})`. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `G-XXXXXXX` | Used directly via gtag **only when no GTM id is set** (`send_page_view:false`). Also on the sandbox's "never send here" list. |
| `GA_PRODUCTION_MEASUREMENT_ID` | `G-XXXXXXX` | Set this when you use GTM only, so the sandbox guard still knows the production id. |
| `NEXT_PUBLIC_GOOGLE_ADS_ID` | `AW-XXXXXXXXX` | gtag config under marketing consent, **gtag fallback only**. With GTM, add Ads tags inside GTM instead (section 10). |

`NEXT_PUBLIC_*` values are inlined at build time; redeploy after changing them.

## 1. Property and web stream

1. GA4 → **Admin** → **Create** → **Property**. Name `MRT Time`, reporting time zone **(GMT+08:00) Singapore**, currency **SGD**. Finish the business details.
2. Choose platform **Web**. Website URL `https://mrt.91208274.xyz`, stream name `MRT Time web`. Create stream and copy the **Measurement ID** (`G-XXXXXXX`).
3. In the stream, **Enhanced measurement** → gear icon → **Page views** → **Show advanced settings** → untick **Page changes based on browser history events**. The app sends its own `page_view` on every route change; leaving this on double-counts SPA navigations. Save.
4. Optional in the same panel: leave Scrolls/Outbound clicks/File downloads on; **Site search** is harmless (the app has no search query params); **Form interactions** only sends form ids, never field values.
5. Admin → **Data collection and modification** → **Data retention** → **Event data retention: 14 months** (the maximum for standard properties). Keep "Reset user data on new activity" on. Save.
6. Admin → **Data collection** → **Google signals**: leave **off** unless you need demographics/cross-device ads data (it would need marketing consent anyway).

## 2. Tag loading (pick one)

### A. GTM (recommended)

Create a container at tagmanager.google.com → **Create account** → container name `mrt.91208274.xyz`, target **Web**. Copy `GTM-XXXXXXX` into `NEXT_PUBLIC_GTM_ID`. Then do section 3.

Do **not** add a Consent Mode default template, a Meta Pixel tag or a Clarity tag in GTM: the app already sets consent defaults/updates before GTM loads, and loads Pixel/Clarity itself under the right consent. Adding them in GTM would double-fire.

### B. gtag fallback

Leave `NEXT_PUBLIC_GTM_ID` empty and set `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXX`. Nothing else to configure; all parameters are sent with each `gtag('event', …)`, and internal sessions get `traffic_type:'internal'` in the config. Skip to section 4.

## 3. GTM container

### Variables

**Variables** → **User-Defined Variables** → **New** → **Data Layer Variable**, version 2, one per parameter. Name them `DLV - <param>`:

`station`, `line`, `direction`, `journey_type`, `confidence`, `standalone`, `language`, `user_type`, `experiment_id`, `variant`, `kol_handle`, `campaign`, `traffic_type`, `creative_id`, `format`, `placement`

plus any event-specific params you want in GA4: `page_type`, `from_station`, `to_station`, `mode`, `transfers`, `basis`, `verdict`, `kind`, `status`, `trains`, `platform`, `method`, `content_type`, `domain`, `link_type`, `level`, `rating`, `category`, `score`, `double_opt_in`, `code_used`, `source`, `medium`, `metric`, `value`, `analytics`, `marketing`.

Built-in variable `Event` must be enabled (it is by default).

### Triggers

1. **Initialization - All Pages** (built-in) for the Google tag.
2. **New** → **Custom Event**, name `MRT events`, event name (tick **Use regex matching**):

```
^(page_view|station_view|journey_view|planner_query|prediction_view|prediction_feedback|log_reading|log_trip_event|submit_reading|install_prompt_shown|app_installed|standalone_open|share|outbound_click|alert_view|crowd_view|feedback_submit|nps_submit|newsletter_signup|experiment_exposure|kol_landing|campaign_landing|consent_update|web_vital|ad_impression|ad_viewable|ad_click)$
```

Update this list when you add an event.

### Tags

1. **Google tag** — Tag ID `G-XXXXXXX`. **Configuration settings**: `send_page_view` = `false`; `traffic_type` = `{{DLV - traffic_type}}`. Trigger: Initialization - All Pages.
2. **Google Analytics: GA4 Event** — Measurement ID `G-XXXXXXX`; Event Name `{{Event}}`; **Event Parameters**: one row per DLV above (`station` → `{{DLV - station}}`, …, `traffic_type` → `{{DLV - traffic_type}}`). Trigger: `MRT events`.

### Consent settings

1. Container **Admin** → **Container Settings** → tick **Enable consent overview**.
2. GA4 tags have built-in consent checks (`analytics_storage`). To keep the setup strictly "basic" (no cookieless pings when a visitor granted **marketing only**, which still loads GTM), open each GA4 tag → **Advanced Settings** → **Consent Settings** → **Require additional consent for tag to fire** → `analytics_storage`.
3. Google Ads tags (section 10): require `ad_storage` (and `ad_user_data`).

### Test and publish

1. **Preview** → enter `https://mrt.91208274.xyz` → accept analytics in the site banner.
2. Check each event appears on the `MRT events` trigger and the GA4 Event tag fires with the expected parameters. Values don't carry over between events: every push first resets all custom-dimension keys to `undefined`, then sets this event's values.
3. **Submit** → **Publish**.

## 4. Custom definitions

Admin → **Data display** → **Custom definitions** → **Create custom dimension**. All **Event** scope. Dimensions only populate from the moment they are registered.

| Dimension name | Scope | Event parameter |
|---|---|---|
| Station | Event | `station` |
| Line | Event | `line` |
| Direction | Event | `direction` |
| Journey type | Event | `journey_type` |
| Confidence | Event | `confidence` |
| Standalone | Event | `standalone` |
| Language | Event | `language` |
| User type | Event | `user_type` |
| Experiment ID | Event | `experiment_id` |
| Variant | Event | `variant` |
| KOL handle | Event | `kol_handle` |
| Campaign (app) | Event | `campaign` |
| Traffic type | Event | `traffic_type` (optional; the data filter works without registering it) |
| Ad creative ID | Event | `creative_id` (house ads, see docs/ads-setup.md) |
| Ad format | Event | `format` |
| Ad placement | Event | `placement` |

`data_source` is in `GA4_DIMENSIONS` but is only sent to the **sandbox** property; do not register it here.

Useful optional extras: `page_type`, `mode`, `basis`, `verdict`, `platform`, `content_type`, `category`. Standard properties have a cap on event-scoped custom dimensions (verify in the UI); the list above uses 16.

Caveat: `station` holds a slug (`outram-park`) on `page_view`/`station_view` and a platform code (`TE17`) on board events. Always pair it with an event-name filter.

## 5. Key events

Admin → **Data display** → **Key events** → **New key event** → type the name (works before data arrives), or star the event in **Events** once it has been collected.

| Key event | Why |
|---|---|
| `planner_query` | Core value action: the visitor asked for a door-to-door plan. Primary conversion for campaigns and the `landing_hero` experiment. |
| `app_installed` | Strongest retention signal (PWA on home screen). Note iOS Safari never fires it. |
| `newsletter_signup` | Owned-channel lead; the only event with an email behind it (email stays in Neon). |
| `submit_reading` | Community contribution that improves predictions. Fires for `rate_limited` too, so filter `status != rate_limited` in reports. |

Keep `page_view`, `prediction_view` etc. as plain events.

## 6. Internal traffic

The app tags owner/analyst activity itself: every event carries `traffic_type=internal` when `user_type` is `owner` or `analyst` (and the gtag config / dataLayer gets it too). No IP rule is needed.

1. Admin → **Data collection and modification** → **Data filters**. New properties usually already have an **Internal Traffic** filter in *Testing* state (verify in the UI). If not: **Create filter** → **Internal traffic** → name `Internal Traffic`, operation **Exclude**, parameter value `internal`.
2. Leave it in **Testing** for a few days. In **Explore** → free form, add dimension **Test data filter name**: your own sessions should show `Internal Traffic`.
3. Switch the filter to **Active**. Excluded data is gone permanently; Testing mode is reversible.
4. Optional: also activate the **Developer traffic** filter so DebugView/Preview hits are excluded.

The server-side proxy never logs signed-in owners/analysts, and first-party rows keep `user_type`, so `event_log` does not need this filter.

## 7. Unwanted referrals

Admin → **Data collection and modification** → **Data streams** → web stream → **Configure tag settings** → **Show more** → **List unwanted referrals** → condition **Referral domain contains** `accounts.google.com` → Save.

This stops the Google sign-in round trip from starting a new "referral" session.

## 8. Audiences

Admin → **Data display** → **Audiences** → **New audience** → **Create a custom audience**. Register `standalone` first (section 4).

| Audience | Builder conditions | Membership |
|---|---|---|
| **Commuters** | Include users when: event `prediction_view`, **Event count ≥ 3**, with a 7-day time window if offered (verify in the UI). Add condition `user_type` exactly matches `visitor`. Weekday restriction: the audience builder has no day-of-week dimension as far as documented (verify in the UI); use the all-days version, and analyse weekday behaviour in Explorations ("Day of week name") or BigQuery (query below). | 30 days |
| **Weekend users** | Needs a day-of-week condition, which the builder doesn't document (verify in the UI). If it is available: event `prediction_view` count ≥ 1 where day of week ∈ Saturday, Sunday. Otherwise use an Explorations user segment with "Day of week name" ∈ Saturday, Sunday for reporting, and build the exact list in BigQuery (same pattern as the commuter query below with `DAYOFWEEK IN (1, 7)`). | 30 days |
| **Installers** | Include users when **any of**: event `app_installed` (count ≥ 1) **OR** any event with parameter `standalone` exactly matches `yes`. | Maximum |
| **Churn-risk** | Target: active 14–28 days ago, not in the last 14 days. The builder cannot express "not in the last 14 days" directly (verify in the UI). Workaround: audience **Active 28d** (event `prediction_view` count ≥ 1, membership 28 days) and **Active 14d** (same condition, membership 14 days); churn-risk ≈ Active 28d minus Active 14d (compare in a Segment overlap exploration). Exact list: BigQuery query below. GA4 predictive "likely 7-day churning users" needs volume thresholds this app may not meet. | 28 days |

Audiences only collect members from creation onward.

## 9. Explorations templates

**Explore** → **Blank**. Save each with the name shown.

| Exploration | Technique | Setup |
|---|---|---|
| `Core funnel` | Funnel exploration | Steps: 1 `page_view` → 2 `prediction_view` → 3 `planner_query` → 4 `app_installed`. Closed funnel, indirectly followed. Breakdown: `Campaign (app)` or `Variant`. Segment comparison: device category. Mirrors the admin funnel (which is per device, consenting only). |
| `Paths from landing` | Path exploration | Starting point: event `page_view`; node type Event name; show 4 steps. Add a second one ending at `planner_query`. |
| `Weekly retention` | Cohort exploration | Inclusion: First touch; Return criteria: event `prediction_view`; granularity Weekly; calculation Standard; breakdown `Language` or `Standalone`. |
| `Audience overlap` | Segment overlap | Segments: Commuters, Weekend users, Installers (create as user segments with the same conditions as the audiences). |
| `Stations & confidence` | Free form | Rows: `Station`, `Line`; columns: `Confidence`; values: Event count, Total users; filter Event name = `prediction_view`. Duplicate tab with filter `prediction_feedback`, columns `verdict` (needs registering) for accuracy feedback. |
| `Experiment` | Free form | Rows: `Variant`; values: Total users, Key events (`planner_query`), Session key event rate; filter `Experiment ID` = `landing_hero`. Use the admin `/admin/experiments` view for the significance note. |

## 10. Google Ads

1. GA4 Admin → **Product links** → **Google Ads links** → **Link** → choose the Ads account → enable auto-tagging → Submit.
2. Google Ads → **Goals** → **Conversions** → **New conversion action** → **Import** → **Google Analytics 4 properties** → **Web** → tick `planner_query`, `app_installed`, `newsletter_signup` → **Import and continue**. Set `planner_query` as primary for bidding only once volume is meaningful (verify the menu path in the UI).
3. Remarketing/conversion tags:
   - **gtag fallback:** set `NEXT_PUBLIC_GOOGLE_ADS_ID=AW-XXXXXXXXX`; it is configured only with marketing consent.
   - **GTM:** `NEXT_PUBLIC_GOOGLE_ADS_ID` is ignored when `NEXT_PUBLIC_GTM_ID` is set. Add a **Conversion Linker** tag and any Google Ads tags in GTM, each requiring `ad_storage` consent.
4. Ads audiences from GA4 only receive users who granted marketing consent (`ad_user_data`/`ad_personalization` granted).

## 11. BigQuery export

1. Create a Google Cloud project (BigQuery sandbox is fine to start).
2. GA4 Admin → **Product links** → **BigQuery links** → **Link** → choose project → data location (e.g. `asia-southeast1`) → **Daily** export (Streaming optional, billed) → Submit.
3. Tables appear as `PROJECT.analytics_<PROPERTY_ID>.events_YYYYMMDD` from the next day; no backfill of earlier data.

Example: planner queries per day by origin station, excluding internal traffic:

```sql
SELECT
  PARSE_DATE('%Y%m%d', event_date) AS day,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'from_station') AS from_station,
  COUNT(*) AS queries,
  COUNT(DISTINCT user_pseudo_id) AS users
FROM `PROJECT.analytics_PROPERTY_ID.events_*`
WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL 28 DAY))
                        AND FORMAT_DATE('%Y%m%d', CURRENT_DATE('Asia/Singapore'))
  AND event_name = 'planner_query'
  AND IFNULL((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type'), '') != 'internal'
GROUP BY day, from_station
ORDER BY day, queries DESC;
```

Weekday commuters (≥ 3 `prediction_view` on Mon–Fri in the last 7 days) and churn-risk users:

```sql
WITH ev AS (
  SELECT user_pseudo_id, event_name,
         DATE(TIMESTAMP_MICROS(event_timestamp), 'Asia/Singapore') AS d
  FROM `PROJECT.analytics_PROPERTY_ID.events_*`
  WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL 29 DAY))
    AND IFNULL((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'traffic_type'), '') != 'internal'
)
SELECT 'commuter' AS segment, user_pseudo_id
FROM ev
WHERE event_name = 'prediction_view'
  AND d > DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL 7 DAY)
  AND EXTRACT(DAYOFWEEK FROM d) BETWEEN 2 AND 6
GROUP BY user_pseudo_id
HAVING COUNT(*) >= 3
UNION ALL
SELECT 'churn_risk', user_pseudo_id
FROM ev
GROUP BY user_pseudo_id
HAVING MAX(d) <= DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL 14 DAY)
   AND MAX(d) >  DATE_SUB(CURRENT_DATE('Asia/Singapore'), INTERVAL 28 DAY);
```

## 12. Looker Studio

We don't ship a template file; build one report with these data sources:

1. lookerstudio.google.com → **Create** → **Data source** → **Google Analytics** → the production property.
2. Optional: **BigQuery** → `analytics_PROPERTY_ID` → `events_*` (or a saved query like the ones above).
3. Optional: **PostgreSQL** connector to Neon for first-party data (`event_log`, `prediction_check`, `api_metric`). Use a dedicated **read-only** Neon role and SSL; never the app's `DATABASE_URL` user. Prefer views that exclude `user_type <> 'visitor'` rows.

Suggested pages:

| Page | Content |
|---|---|
| Overview | Users, sessions, key events, by date; Language and Standalone split |
| Acquisition | Session source/medium, `Campaign (app)`, `KOL handle`; cost from Data import if used |
| Product | `prediction_view` by Station/Line/Confidence; `planner_query` by mode; `prediction_feedback` verdicts |
| Funnel & experiment | Funnel steps as scorecards; `Variant` × key event rate |
| Retention | Cohort table from BigQuery |
| Performance (Neon) | Web Vitals p75, API latency p50/p95, prediction accuracy |

## 13. Verify consent mode

1. Fresh incognito window → open the site, **don't** answer the banner. DevTools → Network: there must be **no** requests to `googletagmanager.com`, `google-analytics.com`, `connect.facebook.net` or `clarity.ms`.
2. tagassistant.google.com → **Add domain** → `https://mrt.91208274.xyz` → Connect. Accept **analytics only**.
3. In Tag Assistant, open the first event → **Consent** tab: *Default* shows all four signals `denied`; *Update* shows `analytics_storage: granted`, `ad_storage`/`ad_user_data`/`ad_personalization: denied`.
4. Check GA4 hits (`/g/collect`) carry your events with the custom parameters. The `gcs` parameter encodes consent state (verify the expected value in the UI/docs).
5. Change consent in **Settings** to marketing on: Tag Assistant shows a new consent update with `ad_*` granted, and the Meta Pixel loads.
6. Sign in as owner → events show `traffic_type=internal` in DebugView (Admin → DebugView while Tag Assistant is connected).
