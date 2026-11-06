# Ads inside MRT Time (publisher side)

MRT Time is also a practice product for marketing. On the ads side the
marketing collaborator usually works as the **advertiser**: buying Meta and
Google ads that point at the app. These ads give the other view, the
**publisher** one: the app sells space in its own pages.

Two systems share the same slots:

1. **Google AdSense**: real third-party ads, paid by Google. Off until `NEXT_PUBLIC_ADSENSE_CLIENT` is set.
2. **House ads**: our own campaigns, served by the app. The units are drawn to look like Meta feed/story cards and Google display/search ads. Spend is simulated, so the full advertiser report (impressions, viewable %, CTR, CPM/CPC, conversions) can be practised without paying anyone.

## Where ads appear

| Placement | Page | Tried first | Fallback |
|---|---|---|---|
| `station` | `/station/[slug]`, right below the live board | AdSense (`NEXT_PUBLIC_ADSENSE_SLOT_STATION`) | House ad |
| `station_sponsored` | `/station/[slug]`, a "Sponsored" block below exits/nearby | House ads only | "Reach MRT commuters here" (links to `/media-kit`) |
| `planner` | `/plan`, below the results | AdSense (`…_SLOT_PLANNER`) | House ad |
| `landing` | `/` for visitors, between "Station boards" and "How it works" | AdSense (`…_SLOT_LANDING`) | House ad |

Ads never appear on the owner Home, `/admin`, `/add`, `/settings` or `/sign-in`.

Each slot reserves a fixed 300 px height, so nothing jumps when an ad loads (no CLS). A slot only requests an ad when it comes within about 600 px of the viewport. AdSense gets 2.5 s to fill. If `data-ad-status` is not `filled` by then, the slot shows a house ad instead.

## Environment variables

| Variable | Example | Effect |
|---|---|---|
| `NEXT_PUBLIC_ADSENSE_CLIENT` | `ca-pub-1234567890123456` | Enables AdSense and `/ads.txt`. Must match `ca-pub-` + digits, otherwise it is ignored. |
| `NEXT_PUBLIC_ADSENSE_SLOT_STATION` | `1234567890` | Display ad unit id for the station slot |
| `NEXT_PUBLIC_ADSENSE_SLOT_PLANNER` | `1234567891` | Display ad unit id for the planner slot |
| `NEXT_PUBLIC_ADSENSE_SLOT_LANDING` | `1234567892` | Display ad unit id for the landing slot |

These are `NEXT_PUBLIC_` values, so they are fixed at build time: redeploy after changing them. A placement without a slot id shows house ads only.

## 1. Apply for AdSense (mrt.91208274.xyz)

1. Sign in at <https://adsense.google.com> with the owner's Google account and create the account (Singapore, SGD payments).
2. **Sites → Add site**. AdSense's help ("Add a site", answer 12169212) only says to enter the site URL. It doesn't say whether a subdomain can be added on its own or whether approving the root domain covers subdomains. Try `mrt.91208274.xyz` first. If the form insists on a root domain, add `91208274.xyz`. In both cases the review crawls the pages the code is on.
3. Verify ownership. Either paste the AdSense code snippet, or use **ads.txt**, which this app supports out of the box:
   - Set `NEXT_PUBLIC_ADSENSE_CLIENT` in Vercel and redeploy.
   - `https://mrt.91208274.xyz/ads.txt` now returns:
     ```
     google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0
     ```
     (`f08c47fec0942fa0` is Google's certification authority id; the publisher id is `pub-` + 16 digits, i.e. the client id without `ca-`.)
4. **Root-domain ads.txt.** Google's crawler starts at the root domain. From the ads.txt FAQ (answer 9785052): "Google crawls and enforces ads.txt files placed on subdomains, where one exists, and is referenced from the ads.txt file on the root domain." So also serve `https://91208274.xyz/ads.txt` with the same `google.com, pub-…` line. One of these is needed:
   - Add `subdomain=mrt.91208274.xyz` to the root file. Google says this is only required when the seller or publisher id differs for the subdomain, but adding it does no harm.
   - Or redirect the root `ads.txt` to `https://mrt.91208274.xyz/ads.txt`. Redirects are allowed while they stay inside the root domain.
5. Choose **Google's CMP** (or "I'll use a different CMP") at the European regulations step. See the consent notes below.
6. Wait for review. That usually takes days and sometimes weeks. Thin pages are a common reason for rejection. Station pages carry exits, nearby places and FAQs, and should be indexable (see the sitemap).
7. Once approved, create three **Display ad units** (responsive) under **Ads → By ad unit**. Name them `station`, `planner` and `landing`, then copy each `data-ad-slot` number into the matching env var. Leave **Auto ads off**: the app places its own slots and keeps them away from owner pages.

`/ads.txt` returns 404 while `NEXT_PUBLIC_ADSENSE_CLIENT` is unset. `pnpm smoke <url>` checks the line once it is set.

## 2. Consent and policy notes

- **Consent Mode v2 basic, the same rule as GA/Meta:** before the visitor decides, or when they reject everything, the AdSense script is not loaded at all (`thirdPartyScripts()` returns nothing, as the tests check).
- With **analytics consent only**, AdSense loads non-personalised. `(adsbygoogle=window.adsbygoogle||[]).requestNonPersonalizedAds=1` is set before the library runs (AdSense help answer 7670312). Google notes that non-personalised ads still use cookies for frequency capping and aggregated reporting (answer 9007336), so they still need *some* consent.
- **Marketing consent** loads personalised ads.
- **EEA, UK, Switzerland:** Google only serves personalised ads there through a *Google-certified CMP integrated with IAB TCF* (answer 13554116). The app's own banner is not a certified CMP. Visitors from those regions will get non-personalised or limited ads at best. The audience is mostly Singapore, so this is acceptable. Switch on Google's CMP in AdSense if EU traffic ever matters.
- **Internal traffic never loads AdSense.** The owner and analysts, i.e. anyone signed in, never get the AdSense script and never get AdSense slots. Clicking your own ads is invalid traffic and can get the account closed. Don't click AdSense ads from a signed-out browser either.
- Never ask people to click ads. Never place ads beside the reading-entry buttons, where an accidental tap is likely. (`/add` and owner Home have no ads for this reason.)
- Labels: AdSense draws its own. House ads always show "Sponsored" or "Ad", or "廣告" in Chinese.
- `/privacy` already describes house-ad measurement, consent-gated AdSense and the opt-out at <https://adssettings.google.com>. Check the wording again if AdSense's own policy requirements change.

## 3. Why no Meta Audience Network

Meta Audience Network, Meta's publisher-side product, serves ads into **mobile apps** (and some in-stream video partners). It no longer supports mobile-web or desktop-web placements. A PWA like MRT Time is a website, so it can't join as a publisher. Meta-style formats are simulated as house ads instead, so the creative and reporting skills still apply. The Meta Pixel and Conversions API work on the advertiser side and are covered in [meta-setup.md](meta-setup.md).

## 4. House campaigns

Tables (migration `0001_ads`):

| Table | What it holds |
|---|---|
| `ad_campaign` | `slug` (becomes `utm_campaign`), name, advertiser, objective `awareness\|traffic\|conversion`, status `active\|paused\|ended`, start/end, daily budget (SGD), bid model `cpm\|cpc`, bid amount (SGD), `targeting` jsonb |
| `ad_creative` | campaign, format `meta_feed\|meta_story\|google_display\|google_search_text`, headline, primary text, description, image URL **or** an uploaded image stored as a data URL (≤ 200 KB), CTA label, destination URL, A/B `weight`, status |
| `ad_event` | `impression\|viewable\|click`, creative, campaign, format, placement, session id, device id (analytics consent only), `internal` flag |

### Seed the house campaigns

```bash
pnpm ads:seed            # idempotent upsert (campaigns by slug, creatives by ref); Hermes runs this
pnpm ads:seed --dry-run  # list what would be written
```

It seeds three self-promotional campaigns. No real third-party brands are used.

| Campaign | Formats | Bid | Budget/day | Destination |
|---|---|---|---|---|
| Install MRT Time (`install-mrt-time`) | `meta_story`, `google_display` (mobile/tablet only) | CPM S$4 | S$5 | `/settings#install` |
| Join the newsletter (`join-newsletter`) | `meta_feed` | CPC S$0.30 | S$3 | `/#newsletter` |
| Read the accuracy report (`accuracy-report`) | `google_search_text` | CPC S$0.20 | S$2 | `/accuracy` |

### Create and edit in Admin → Ads

- **Campaign form:** objective, status, dates (end date inclusive), budget, bid, and targeting checkboxes. Targeting covers stations, lines, languages, time bands (`weekday_am_peak`, `weekday_pm_peak`, `weekday_offpeak`, `weekend`) and devices. Leaving every box unticked means "any". Targeting is contextual only: no personal data is used.
- **Creative editor:** a live preview in the chosen format, plus small previews in the other three. It also shows the final click-through URL with UTM. Images are either a URL or an upload of 200 KB or less.
- To A/B test, give a campaign two or more creatives and set their **weights**: 3 and 1 means a 75/25 split. A weight of 0 takes the creative out of rotation.

### How serving works (`src/lib/ads/select.ts`, unit-tested)

1. **Eligible:** status `active`, inside the start/end dates, and targeting matches the request (station page, its lines, UI language, SGT time band, device type).
2. **Pacing:** spend is simulated as CPM per 1,000 impressions or CPC per click, at the campaign's bid, for today's (SGT) non-internal events. Once spend reaches the daily budget, the campaign stops until midnight.
3. **Frequency cap:** at most 3 impressions per campaign per session.
4. **Auction:** campaigns are picked at random, weighted by effective CPM. CPC bids count as bid × 1 % CTR × 1000. Within the chosen campaign, a creative is picked by its A/B weight.

### Tracking

- **Impression:** logged when the house ad renders (`POST /api/ads/event`).
- **Viewable:** logged when at least 50 % of the unit is visible for at least 1 s (IntersectionObserver). This follows the MRC display standard.
- **Click:** the unit links to `/api/ads/click?c=<creative>&p=<placement>&s=<session>`. That route logs the click, then 302s to the destination with UTM appended: `utm_source=mrt_house`, `utm_medium=<format>`, `utm_campaign=<campaign slug>`, `utm_content=<creative id>`. The destination always comes from the database, so the route can't be used as an open redirect.
- **Session:** with analytics consent this is the analytics session id, which lets post-click conversions be joined. Without consent it is a random id kept in `sessionStorage` for the tab only, used for frequency capping. A device id is stored only with analytics consent.
- **Internal traffic:** events from signed-in owners and analysts are stored with `internal=true`. They are left out of reports and pacing.

### Report (Admin → Ads)

For each of campaign, creative, format and placement, over the chosen date range: impressions, viewable, viewable %, clicks, CTR %, simulated spend (S$), effective CPM, effective CPC, and **post-click conversions**. A conversion is a `planner_query`, `app_installed` or `newsletter_signup` in the same session after the click, within one day. Each table has a CSV export (`/api/admin/ads-report?by=…`). The raw `ad_event` rows are available too (`/api/admin/export?table=ad_event`).

## 5. GA4 ad events

House-ad events go through the same consent-gated `track()` allowlist as every other event, so they are mirrored to GA4 (GTM dataLayer or gtag) only with consent:

| Event | Params |
|---|---|
| `ad_impression` | `creative_id`, `format`, `placement`, `campaign` |
| `ad_viewable` | same |
| `ad_click` | same |

In GA4, register `creative_id`, `format` and `placement` as event-scoped custom dimensions (`campaign` already is). Add the three names to the GTM "MRT events" trigger regex ([ga4-setup.md](ga4-setup.md)). Don't mark `ad_click` as a key event. The conversions that matter are the ones that happen after the click.

The **Practice Sandbox** property gets the same events, synthetically, with different CTRs per format. 40 % of impressions are AdSense-like, carrying `ad_source=adsense` and `ad_revenue` (SGD per impression) plus `currency=SGD`, so revenue-per-session and ad-CTR reports can be practised. See [sandbox.md](sandbox.md).
