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
| `direction` | Must exist on the platform's line: EWL `TO_EAST` / `TO_WEST`, TEL `TO_BAYSHORE` / `TO_NORTH`, NEL `TO_HARBOURFRONT` / `TO_PUNGGOL`. |
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
| `station`, `line`, `direction` | Optional context. `board` events with `station` + `direction` also store the prediction for that moment in `prediction_check` (feeds `/accuracy`). |
| `journeyKey` | Optional: `home_to_office`, `office_to_home`, `office_to_home_tp`, … |
| `note` | Optional free text (≤ 500 chars). Never sent to analytics. |

## Responses

| Status | Meaning |
|---|---|
| `201` | `{ "readings": [{ "ok": true, "id": 12, "status": "approved", "line": "TEL" }, …], "tripEvents": [{ "ok": true, "id": 40 }, …] }` — per-item results; invalid items come back as `{ "ok": false, "error": "invalid" }` without failing the batch. |
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
- Map the board's destination to a direction: Pasir Ris → `TO_EAST`; Joo Koon / Tuas Link → `TO_WEST`; Bayshore → `TO_BAYSHORE`; Woodlands North / Springleaf → `TO_NORTH`; HarbourFront → `TO_HARBOURFRONT`; Punggol Coast → `TO_PUNGGOL`.
- "Arr" or "0" on the board means `0` minutes.
- The public form (`POST /api/readings`) is separate: it is rate-limited and auto-approves only readings consistent (±2 min) with an approved reading in the same 30-minute window.
