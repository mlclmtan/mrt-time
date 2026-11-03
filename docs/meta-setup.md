# Meta Pixel + Conversions API setup

The browser Pixel and the server-side Conversions API (CAPI) send the same five events, deduplicated by a shared event id. Both run **only for visitors who granted marketing consent**. Code: `src/lib/analytics/mapping.ts` (`metaEventFor`), `src/lib/analytics/meta-capi.ts`, `src/lib/analytics/ingest.ts`, `src/lib/analytics/scripts.ts`, `src/components/analytics/analytics-provider.tsx`.

Menu names below follow Meta's documentation at the time of writing; **verify in the UI** where noted.

## Env vars

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | build-time public | Pixel/dataset id (8–20 digits; anything else is ignored). Needed by both Pixel and CAPI. |
| `META_CAPI_TOKEN` | server only | Conversions API access token. CAPI is a no-op unless both this and the pixel id are set. |
| `META_TEST_EVENT_CODE` | server only | Test Events code (e.g. `TEST12345`). Remove after testing. |

Redeploy after changing any of them.

## 1. Create the Pixel

1. Meta **Events Manager** → **Connect data sources** → **Web** → **Meta Pixel** (may be labelled *dataset*) → name `MRT Time` → website `https://mrt.91208274.xyz` → choose the manual / code setup path and skip partner integrations (verify in the UI).
2. Copy the Pixel id → `NEXT_PUBLIC_META_PIXEL_ID`.
3. Pixel **Settings** (verify in the UI):
   - **Automatic advanced matching: off.** It would hash form fields such as the newsletter email; we deliberately send no customer information.
   - **Track events automatically without code: off.** The app also calls `fbq('set','autoConfig',false, …)`.
   - **First-party cookies: on**, so `_fbp`/`_fbc` exist and can be passed to CAPI.

## 2. Conversions API token

1. Events Manager → the Pixel → **Settings** → **Conversions API** → **Generate access token** (verify in the UI). A Business Manager system-user token with access to the pixel also works.
2. Put it in `META_CAPI_TOKEN` (Vercel → Project → Settings → Environment Variables, Production). Never prefix it with `NEXT_PUBLIC_`.
3. The app posts to `https://graph.facebook.com/v26.0/<PIXEL_ID>/events?access_token=…` (`META_GRAPH_VERSION` in `meta-capi.ts`; bump it when Meta deprecates v26.0).

## 3. Event mapping

| App event | Meta event | Type | `custom_data` |
|---|---|---|---|
| `page_view` | `PageView` | standard | — |
| `station_view` | `ViewContent` | standard | `content_type: "station"`, `content_ids: [<station slug>]` |
| `newsletter_signup` | `Lead` | standard | — |
| `app_installed` | `CompleteRegistration` | standard | `status: "installed"` |
| `planner_query` | `PlanJourney` | custom (`trackCustom`) | `mode`, `transfers` |

Everything else is not sent to Meta. To optimise campaigns on `PlanJourney`, create a **Custom conversion** on it in Events Manager.

`app_installed` relies on the browser `appinstalled` event, which iOS Safari does not fire, so iOS installs won't reach Meta.

## 4. How deduplication works here

1. `track()` creates a random UUID `event_id` per event.
2. Browser: `fbq('track' | 'trackCustom', <event>, <data>, { eventID: event_id })`.
3. The same envelope goes to `POST /api/events` with `consent.marketing`, `fbp`, `fbc`. `buildEventRow()` builds the CAPI body when the event maps to Meta, marketing consent is true and CAPI is configured; `storeEvent()` sends it after writing the `event_log` row (4 s timeout, failures ignored).
4. CAPI body per event:

```json
{
  "data": [{
    "event_name": "PlanJourney",
    "event_time": 1793600000,
    "event_id": "<same uuid as the Pixel eventID>",
    "action_source": "website",
    "event_source_url": "https://mrt.91208274.xyz/plan",
    "user_data": { "client_user_agent": "<UA>", "fbp": "fb.1.…", "fbc": "fb.1.…" },
    "custom_data": { "mode": "depart", "transfers": 1 }
  }],
  "test_event_code": "TEST12345"
}
```

Meta keeps one copy when the Pixel `eventID` equals the CAPI `event_id` for the same event name within 48 hours. `event_time` is the server receive time (well within Meta's 7-day limit). `event_source_url` is origin + path only (no query string). `test_event_code` appears only when `META_TEST_EVENT_CODE` is set.

If the Pixel script hasn't finished loading when an event fires (e.g. the first `page_view` right after consent), only the CAPI copy arrives. That is expected and still counted once.

## 5. Test Events

1. Events Manager → the Pixel → **Test events** → copy the test code.
2. Set `META_TEST_EVENT_CODE=TEST12345` (your code) in Vercel → redeploy.
3. Open the site in a fresh browser, accept **marketing** in the consent banner, visit a station page, run a planner query.
4. In Test events you should see `PageView`, `ViewContent`, `PlanJourney` from both **Browser** and **Server**, marked as deduplicated.
5. **Remove `META_TEST_EVENT_CODE` and redeploy** when done.

Diagnostics in Events Manager may warn about low Event Match Quality: expected, see below.

## 6. What we deliberately don't send

- **No IP address** (`client_ip_address` is never set).
- **No email, phone, name, external id** or any hashed customer information. Newsletter emails stay in Neon.
- **No query strings** in `event_source_url`.
- Only `client_user_agent` (required for `action_source: website`), `_fbp` and `_fbc` cookies.

The cost is weaker matching and smaller retargeting audiences. That trade-off is intentional; don't enable automatic advanced matching to "fix" it.

## 7. Consent

- The Pixel script is injected only when `mrt_consent` has marketing granted (`thirdPartyScripts()`), and `fbq` calls only happen with marketing consent.
- CAPI is sent only when the event envelope says `consent.marketing: true`.
- Withdrawing marketing consent in Settings stops further Pixel/CAPI events; the Pixel script already loaded in that tab stays until reload.
- Owner/analyst traffic is never sent to Meta: the browser skips `fbq` events and the server skips CAPI unless the signed-in user type is `visitor`.

## 8. Domain verification

1. Meta Business Suite → **Settings** → **Brand safety** → **Domains** → **Add** → `91208274.xyz` (verify in the UI which level Meta asks for).
2. Choose **DNS TXT record** (no code change needed), add the TXT record at your DNS provider, wait for propagation, click **Verify**. The meta-tag method would need a code change to `<head>`.

## 9. Aggregated Event Measurement

Meta's rules for web event prioritisation and measurement have changed several times. After domain verification, check Events Manager for any **web event configuration** or prioritisation prompt for the domain and follow it (verify in the UI). If you need to rank events, use: `CompleteRegistration` → `Lead` → `PlanJourney` (via its custom conversion) → `ViewContent` → `PageView`.
