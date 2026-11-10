# Ingest API (Hermes)

`POST /api/ingest` lets Hermes post board readings and trip events it extracts from photos or messages sent in chat. Photos themselves are never sent or stored (they live in Notion).

## Setup

| Env var | Purpose |
|---|---|
| `INGEST_TOKEN` | Shared secret. Unset → the endpoint answers `503 Ingest is disabled`. |
| `DATABASE_URL` | Required to store anything (`503` otherwise). |
| `ALLOWED_EMAILS` | Trip events are attached to the first owner on this list (or to `ownerEmail` if it is on the list). The owner must have signed in once so their user row exists, or the DB must have been seeded with `pnpm db:seed`. |

Generate a token with `openssl rand -base64 32`, set it in Vercel and in Hermes.

## Request

```http
POST /api/ingest
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

```json
{
  "readings": [
    {
      "station": "TE17",
      "direction": "TO_BAYSHORE",
      "minutes": [2, 8],
      "capturedAt": "2026-11-03T10:21:00+08:00",
      "destination": "Bayshore"
    }
  ],
  "tripEvents": [
    {
      "clientId": "0f8b1c1e-6a0b-4d0e-9a51-7d3f2b1f6a10",
      "kind": "board",
      "at": "2026-11-03T10:22:10+08:00",
      "station": "TE17",
      "line": "TEL",
      "direction": "TO_BAYSHORE",
      "journeyKey": "home_to_office",
      "note": "optional, stays in Neon"
    }
  ],
  "ownerEmail": "owner@example.com"
}
```

All three keys are optional; send up to 50 readings and 100 trip events per call.

### Reading fields

| Field | Rules |
|---|---|
| `station` | Platform code, e.g. `EW17`, `TE19`, `NE3` (see `src/lib/network/data.ts`). |
| `direction` | Must exist on the platform's line (v2.0 covers every MRT line): NSL `TO_JURONG_EAST` / `TO_MARINA_SOUTH_PIER`; EWL `TO_EAST` / `TO_WEST`, Changi Airport branch `TO_CHANGI_AIRPORT` / `TO_TANAH_MERAH`; NEL `TO_HARBOURFRONT` / `TO_PUNGGOL`; CCL `TO_DHOBY_GHAUT` / `TO_PRINCE_EDWARD_ROAD` / `TO_PROMENADE` (via Marina Bay); DTL `TO_BUKIT_PANJANG` / `TO_EXPO`; TEL `TO_BAYSHORE` / `TO_NORTH`. |
| `minutes` | 1–3 integers (0–60), non-decreasing: next, next-next, optional third train. |
| `capturedAt` | ISO 8601 with offset — the photo's capture time, **not** the time Hermes processed it. Default: now. Must be within the last 7 days. |
| `destination` | Optional board destination text (≤ 40 chars). |

Readings from Hermes are stored as `source = "hermes"`, `status = "approved"` and immediately feed predictions. Exact duplicates (same platform, direction, capture time and source) are ignored.

### Trip event fields

| Field | Rules |
|---|---|
| `clientId` | UUID; makes retries idempotent (one row per owner + clientId). |
| `kind` | `door`, `lift_lobby`, `station_entrance`, `tap_in`, `at_platform`, `board`, `alight`, `tap_out`, `desk`, `arrived`. |
| `at` | ISO 8601 with offset — the moment it happened (photo time), never the processing time. |
| `station`, `line`, `direction` | Optional context. `board` and `alight` events with `station` + `direction` also create a **train sighting** (`train_sighting`, `source = "hermes"`, approved): a sighting of a real train at that platform, which boards along the line use at once (propagated by ride times while its error stays ≤ 1.5 min). An `alight` takes the direction of the boarding before it (same line, ≤ 3 h). `board` events logged within 2 min of their time also store the prediction for that moment in `prediction_check` (Hermes' are usually later, so not scored). |
| `timeSource` | Optional (v2.1): `"now"` (tapped as it happened, ±0.5 min) or `"chosen"` (time picked by hand, ±1). Omitted: inferred from how late the event arrives (> 1 min late → ±1). Old bodies without it keep working. |
| `journeyKey` | Optional: `home_to_office`, `office_to_home`, `office_to_home_tp`, … |
| `note` | Optional free text (≤ 500 chars). Never sent to analytics. |

## Responses

| Status | Meaning |
|---|---|
| `201` | `{ "readings": [{ "ok": true, "id": 12, "status": "approved", "line": "TEL" }, …], "tripEvents": [{ "ok": true, "id": 40, "sightingId": 7 }, …] }` (`sightingId` is null for taps that are not a boarding / getting off at a known platform) — per-item results; invalid items come back as `{ "ok": false, "error": "invalid" }` without failing the batch. |
| `400` | Body is not the shape above. |
| `401` | Missing/wrong bearer token. |
| `409` | Trip events sent but the owner user doesn't exist yet (readings in the same call were still saved). |
| `503` | `INGEST_TOKEN` or `DATABASE_URL` not configured. |

## Example

```bash
curl -sS -X POST "https://mrt.91208274.xyz/api/ingest" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "content-type: application/json" \
  -d '{"readings":[{"station":"EW17","direction":"TO_EAST","minutes":[1,5,10],"capturedAt":"2026-11-03T10:21:00+08:00"}]}'
```

## Tips for extraction

- Use the EXIF capture time of the photo as `capturedAt` / `at`, converted to `+08:00`.
- Map the board's destination to a direction: Pasir Ris → `TO_EAST`; Joo Koon / Tuas Link → `TO_WEST`; Changi Airport → `TO_CHANGI_AIRPORT`; Tanah Merah (on the airport branch) → `TO_TANAH_MERAH`; Jurong East → `TO_JURONG_EAST`; Marina South Pier → `TO_MARINA_SOUTH_PIER`; Bayshore → `TO_BAYSHORE`; Woodlands North / Springleaf → `TO_NORTH` (send `destination: "Springleaf"` so the train isn't carried past Springleaf); HarbourFront → `TO_HARBOURFRONT`; Punggol Coast → `TO_PUNGGOL`; Dhoby Ghaut → `TO_DHOBY_GHAUT`; Prince Edward Road → `TO_PRINCE_EDWARD_ROAD`; Bukit Panjang → `TO_BUKIT_PANJANG`; Expo → `TO_EXPO`.
- "I boarded at 10:14" / "got off at 10:17" in chat → a `board` / `alight` trip event with that `at`, the platform and the direction. That is the strongest evidence the app gets (better than a board countdown).
- "Arr" or "0" on the board means `0` minutes.
- The public form (`POST /api/readings`) is separate: it is rate-limited and auto-approves only readings consistent (±2 min) with an approved reading in the same 30-minute window.

## Train sightings (v2.0)

A sighting is a real train seen at a platform at a known moment. Three kinds feed predictions:

| Kind | Where it comes from | Stored in |
|---|---|---|
| `board_reading` | Each minute on a board reading implies a train at `capturedAt + minutes`. | Derived from `observation` on the fly (nothing extra stored). |
| `boarded` | A `board` trip event (owner / Hermes) or a public "I boarded". | `train_sighting` |
| `alighted` | An `alight` trip event or a public "Got off". | `train_sighting` |

Owner and Hermes sightings link to their trip event (`trip_event_id`, unique): editing the event's time or platform in the timeline moves the sighting, deleting the event deletes it. Public ones come from `POST /api/sightings` (`{ station, direction, kind: "boarded" | "alighted", at, timeSource? }`, up to 30 min back), share the board-reading rate limits (10/hour per device + daily IP hash, 20/hour per IP hash) and are approved only when within ±2 min of a train the owner / Hermes put there, or when a second network reports the same train within 1 min; otherwise the owner reviews them in **Admin → Submissions**. Public sightings count only at their own platform until two networks agree.

**Error model (v2.1).** Every sighting stores `error_min`: a tap at Now ±0.5, a chosen time or a board's next train ±1, a board's 2nd / 3rd train ±1.5. Propagation adds 0.3 min a stop (0.1 on measured rides) and stops above 1.5 min, at a possible short-turn (EW29 Joo Koon, TE4 Springleaf — send `destination` when the board names the real terminal) and never starts from a boarding at a terminal. Nothing propagated is stored.

### Backfill (run once after the v2.0 migration)

Trip events logged before v2.0 have no sighting yet. Hermes runs:

```bash
pnpm db:migrate              # applies drizzle/0002_train_sightings.sql and (v2.1) 0003_review_followup.sql
pnpm sightings:backfill      # idempotent: one sighting per board/alight event with a platform + direction;
                             # v2.1: also sets error_min / created_at from the trip event where missing
pnpm sightings:backfill --dry-run   # count only
```

Re-running the backfill updates the same rows (never duplicates).
