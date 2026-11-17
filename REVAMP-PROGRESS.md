# Revamp spec progress (`SPEC-revamp-draft.md`)

Audit of 17 Nov 2026 (v2.3.0). The draft from 3 Nov (private, gitignored) was turned into `SPEC.md` and built in v1.0–v2.2. This round checked every draft item against the code, built the gaps, and lists below what still needs a person.

## Status by draft item

| Draft item | Status | Where |
|---|---|---|
| Commute home screen with a station-board tab | Done (v1.0–v2.2) | owner Home `src/components/owner/owner-home.tsx`, `/station/[slug]` |
| Next.js / Vercel / Neon / Drizzle / Better Auth, installable, version string, update banner | Done | README "Stack", `update-banner.tsx`, `version-footer.tsx` |
| Public read, writes via Google sign-in + `ALLOWED_EMAILS` | Done | `src/lib/auth/` |
| Domain `mrt.91208274.xyz` | Done (live per README) | infra, not in repo |
| Dark MRT-board look with line colours | Done | `globals.css`, `src/lib/network/data.ts` |
| No photos stored | Done | none stored |
| Journey legs, transfer catch, leave-by / arrive-by, "leave desk at" list | Done | `src/lib/journey/plan.ts`, `/plan` |
| Owner's alternative route, fixed leg minutes, best doors | Done as data | owner journeys are seeded from the gitignored `private/seed.json` (not checked here: personal data); door tips render on Home |
| The commute's stations | Done, superseded | every MRT station (v2.0) |
| Logging: boarded now, board reading pad, tap time; Hermes API | Done | `/add`, `boarding-buttons.tsx`, `/api/ingest` |
| Prediction rules (same-day reading wins, 09:15–10:30 ranges, LTA fallbacks, hit rate) | Done, extended | `src/lib/predict/`, `/accuracy` |
| LTA alerts + crowd | Done | `src/lib/server/lta.ts` |
| Seed the owner's earlier readings | Done | `scripts/seed.ts` (data in `private/`) |
| GA4 basic consent mode + custom events | Done | `src/lib/analytics/` |
| ↳ `refresh` event | **Built in v2.3** | `live-board.tsx`, `update-banner.tsx` |
| First-party `event_log`, server page hits, admin dashboard, Web Vitals | Done | `/admin`, `src/proxy.ts` |
| Vercel Web Analytics + Speed Insights | **Built in v2.3** (env-flagged, off by default) | `src/components/analytics/vercel-insights.tsx` |
| /privacy, /terms, opt-out in Settings | Done (privacy copy updated for Vercel) | `/privacy`, Settings → consent |
| Two GA4 properties, MP sandbox, cost import | Done | `src/lib/sandbox/`, `docs/sandbox.md` |
| Key events, custom dimensions, audiences, explorations, Consent Mode v2, internal traffic, unwanted referrals | Done (docs) | `docs/ga4-setup.md` |
| GTM container | Done | `docs/ga4-setup.md` §3 (**regex fixed in v2.3**: it dropped the v2 events) |
| BigQuery export + starter SQL (sessions, funnels, retention, attribution) | **Built in v2.3** | `docs/bigquery/01–04` |
| Looker Studio dashboard | Done (docs; no template file) | `docs/ga4-setup.md` §12 |
| Search Console + SEO pages, sitemap, OG | SEO done; **verification tag + steps built in v2.3** | `siteVerification()` in `src/lib/seo.ts`, `docs/ga4-setup.md` §13 |
| UTM builder + QR, campaign view | Done | `/admin/campaigns` |
| A/B framework, landing headline test | Done | `/admin/experiments` |
| Feedback / NPS / newsletter | Done | `src/components/voc/` |
| ↳ Telegram channel signup | **Built in v2.3** (link, env-flagged) | `newsletter-form.tsx` |
| Clarity with masking, behind consent | Done | `scripts.ts` |
| EN / 繁體中文 | Done | `src/lib/i18n/` |
| Google Ads link, Meta Pixel + CAPI, test events | Done | `docs/meta-setup.md`, `meta-capi.ts` |
| KOL links, codes, dashboard, media kit | Done | `/k/[handle]`, `/r/[code]`, `/admin/kols`, `/media-kit` |
| Leave-now push, disruption push, rain route, crowdsourced readings, accuracy page, bus-app link | Done | `src/lib/push/`, `weather.ts`, `/add`, `/accuracy` |

## Left for a person (not doable from this session)

1. **`.env.example`**: add the four new vars. This session didn't read or edit `.env*` files, as instructed.
   ```
   # Vercel Web Analytics / Speed Insights (enable in the Vercel project first)
   NEXT_PUBLIC_VERCEL_ANALYTICS=
   NEXT_PUBLIC_VERCEL_SPEED_INSIGHTS=
   # Google Search Console HTML-tag token (not needed with DNS verification)
   GOOGLE_SITE_VERIFICATION=
   # Optional public Telegram channel, https://t.me/<channel>
   NEXT_PUBLIC_TELEGRAM_CHANNEL_URL=
   ```
2. **Vercel dashboard:** enable Web Analytics and Speed Insights, set the two flags to `1`, then redeploy. Check the Hobby quota on the usage page.
3. **Search Console:** add the property (DNS TXT recommended), submit `sitemap.xml`, and link it to GA4 (`docs/ga4-setup.md` §13).
4. **Telegram:** create the channel if wanted, then set its URL.
5. **BigQuery SQL:** written against the GA4 export schema but **not executed** (no BigQuery access here). Run each once after the export has a day of data. `04-attribution.sql` relies on `collected_traffic_source`, which only exists in exports created since mid-2023.
6. **Deploy + live check:** not deployed. On a phone (393×852), check the board's **Refresh** button row and the Telegram link. Then run `pnpm smoke <url>`.
7. **Inviting the collaborator** to GA4 / GTM / Looker / Search Console / Clarity: still on hold until the owner confirms (the invitations send email).
