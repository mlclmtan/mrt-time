# KOL playbook

How to onboard a creator (KOL), give them trackable links, read their results and report back. Code: `src/app/admin/kols/page.tsx`, `src/app/admin/campaigns/page.tsx`, `src/app/admin/actions.ts`, `src/app/k/[handle]/page.tsx`, `src/app/r/[code]/route.ts`, `src/lib/analytics/aggregates.ts` (`kolFunnelQuery`, `campaignPerformanceQuery`), `src/app/media-kit/page.tsx`.

Requires `DATABASE_URL`. Only owners can create or edit; analysts can view.

## 1. Create the KOL

`/admin/kols` → form at the top → **Save**.

| Field | Rules | Notes |
|---|---|---|
| Handle | 2–40 chars, `a–z 0–9 _ -`, lower-cased on save, unique | Used in the URL `/k/<handle>`, as `utm_source` and in the dashboard. Saving an existing handle **updates** that creator. |
| Display name | 1–60 chars | Shown publicly: "MRT Time × *name*" and "*name* uses MRT Time to never miss a train." |
| Platform | `instagram`, `tiktok`, `youtube`, `xhs`, `threads`, `other` | For your own reference. |
| Code | 2–20 chars, `A–Z 0–9 _ -`, upper-cased on save, unique | Referral code shown on the landing ("Your code: …") and used in `/r/<CODE>`. A code already used by another handle makes the save fail. |
| Landing variant | `default` or `planner` | See section 3. |
| Notes | ≤ 500 chars | Internal. Don't put contact details, rates or other personal data here. |

Invalid input is silently not saved; check the list below the form. Use the **pause / activate** buttons to switch a creator off: a paused creator's `/k/<handle>` returns 404 and `/r/<CODE>` redirects to `/`.

## 2. Their links

The KOL list shows both links per creator (built from `APP_URL`).

| Link | What happens | Use for |
|---|---|---|
| `https://mrt.91208274.xyz/k/<handle>` | Co-branded landing. If the URL has no `utm_source`, the page rewrites the address bar (no reload) to `?utm_source=<handle>&utm_medium=kol&utm_campaign=kol-<handle>`, so first-touch attribution and GA4 see the KOL UTM. Fires `kol_landing` (`code_used=false`). Not indexed by search engines. | Bio links, link stickers, descriptions |
| `https://mrt.91208274.xyz/r/<CODE>` | 302 to `/k/<handle>?code=1` (code is case-insensitive). The landing fires `kol_landing` with `code_used=true` and keeps `code=1` in the rewritten URL. Unknown/paused code → `/`. | Spoken or on-screen codes ("go to mrt…/r/TRAINFAN") |

`campaign_landing` is deliberately not fired for `utm_medium=kol`; KOL traffic is measured through `kol_landing`. After landing, the handle is remembered (analytics consent) and attached as `kol_handle` to that visitor's later events, in `event_log` and GA4.

## 3. Landing variants

Both variants show the creator co-branding, their code and the station grid.

| Variant | Primary button | Goes to | Pick when |
|---|---|---|---|
| `default` | "See live boards" | `/#stations` | Creator talks about "when's my next train" |
| `planner` | "Plan my trip" | `/plan` | Creator talks about door-to-door commute timing |

The `landing_hero` A/B test runs only on the visitor home page, not on KOL landings.

## 4. Extra placements: campaign builder + QR

For a specific post, story or offline placement, build a tagged link in `/admin/campaigns`:

| Field | Value for a KOL placement |
|---|---|
| Name | free label, e.g. `trainfan IG story 1` |
| Source * | `<handle>` |
| Medium * | `kol` |
| Campaign * | `kol-<handle>` (or `kol-<handle>-<placement>`, see below) |
| Content | placement, e.g. `ig-story-1` |
| Term | optional |
| Campaign ID | optional `utm_id`, e.g. `kol-301` (needed if you import cost into GA4) |
| Landing path | `/k/<handle>` |

All values are slugged (`"Spring Promo!"` → `spring-promo`). Each saved campaign gets a QR code with **SVG** and **PNG** (512 px) downloads: use SVG for print, PNG for chat/social.

Because the URL already has `utm_source`, the KOL landing keeps your UTMs instead of applying its defaults. The admin **campaign performance** table groups by campaign/source/medium only (`utm_content` is stored but not shown there, and isn't in the `event_log` CSV export). If you need a per-placement split inside `/admin`, put the placement in the campaign name (`kol-<handle>-story1`); the KOL funnel still groups by handle.

## 5. Dashboard metrics

`/admin/kols` → date range → **KOL funnel** table. One row per handle, from `kol_landing` events in the range:

| Column | Definition |
|---|---|
| `visits` | Distinct consenting devices with a `kol_landing` for the handle in the range (first landing time `t` per device) |
| `planner` | Of those, devices with a `planner_query` at or after `t` |
| `installs` | Of those, devices with an `app_installed` at or after `t` (Android/desktop Chromium only; iOS never fires it) |
| `active_7d` | Of those, devices with **any event on a later SGT calendar day than the landing and less than 7 × 24 h after it** |

Notes:

- `planner` and `installs` are not capped at the range end, so recent ranges keep growing; `active_7d` needs 7 days to mature. Report a period only once it is 7+ days old.
- Overall campaign view (`/admin/campaigns` → performance): distinct sessions and devices, `planner_query` and `app_installed` counts per campaign/source/medium.

### Consent caveat

- Nothing is sent from the browser before the visitor accepts something in the consent banner, and the funnel only counts devices with **analytics** consent (marketing-only visitors are stored without a device id). So the funnel is a **lower bound** of the creator's real impact.
- Consent-independent count of landings: the proxy logs an anonymous `page_view` for visitors with no consent. Count `page_view` rows whose `route` is `/k/<handle>` or `/zh-Hant/k/<handle>` (dashboard **Top pages**, or the `event_log` CSV export). Don't also add `/r/<CODE>` rows; the redirect lands on `/k/` and would double count.
- Report both: **landings (all visitors)** and **attributable funnel (consenting)**. Consent rate ≈ visits ÷ landings.
- GA4 has the same limitation (it only loads after consent).

## 6. Media kit for pitching

`https://mrt.91208274.xyz/media-kit` (public, refreshed hourly, EN and 繁體中文): users, sessions and page views over the last 30 days, plus the top 5 stations by station views, with a share button. Users/sessions count consenting devices only; page views include anonymous hits. Send it with your first message; pair it with a link to `/accuracy` for credibility.

## 7. Creator brief template

Copy, fill in, send:

```text
MRT Time × <Display name> — brief

What it is: free web app (installable) showing when the next MRT train
arrives, plus a door-to-door "when to leave" planner. EWL, TEL, NEL.

Your links
  Main link:      https://mrt.91208274.xyz/k/<handle>
  Code to say:    <CODE>  → https://mrt.91208274.xyz/r/<CODE>
  Placement link: <campaign builder URL / QR>    (if any)

Key messages (pick 1–2)
  - Know your train before you reach the platform
  - Plan door-to-door: tells you when to leave
  - Add to home screen: opens like an app

Show on screen: a live board for your station, then the planner.
Call to action: "Tap the link / try the planner / add it to your home screen".

Do
  - Disclose the partnership with the platform's paid-partnership tool
    and #ad (follow local advertising disclosure rules)
  - Use your own words and your real commute
Don't
  - Promise exact arrival times ("predictions, not guarantees")
  - Show other people's faces/personal info in screen recordings
  - Edit or shorten the links (UTMs must survive)

Dates: draft <date> · go live <date> · report <date>
Contact: owner@example.com
```

### Checklist

- [ ] KOL created in `/admin/kols`, active, code agreed
- [ ] Opened `/k/<handle>` and `/r/<CODE>` yourself in a private window: co-branding, code chip, URL rewritten with UTMs
- [ ] Extra placements built in `/admin/campaigns`, QR downloaded and test-scanned
- [ ] Brief sent; draft reviewed for disclosure and claims
- [ ] Post live: note date/time and URL in the KOL notes field
- [ ] Day 1: landings appear in **Top pages**; `kol_landing` appears in the funnel
- [ ] Day 8+: report sent (section 8)

## 8. Reporting and payout cadence (suggested)

| When | What |
|---|---|
| Day 1 after go-live | Sanity check: landings > 0, `kol_landing` > 0, no 404s |
| Weekly during the campaign | Snapshot to the creator: landings, visits, planner, installs |
| Month end + 7 days | Final report for the month (so `active_7d` has matured) and payout |

Payout model suggestions:

- **Flat fee** for the content, plus an optional **bonus per 7-day-active device** (the hardest metric to game).
- Agree up front that bonuses use the **attributable (consenting) numbers** as measured in `/admin`, with no grossing-up for non-consenting visitors, and state the attribution window (landing date within the month, activity within 7 days).
- Pay from a screenshot/copy of the `/admin/kols` funnel table for the agreed range (it has no CSV button); keep it with the invoice.
- Keep contracts, rates and payment details outside this app.
