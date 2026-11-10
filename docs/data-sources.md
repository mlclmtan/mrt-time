# Data sources and licences

Everything below is static data shipped in the repo (`src/lib/network/`). No paid APIs.

## Stations (names, codes, coordinates)

File: `src/lib/network/stations-list.ts` — 146 open MRT stations (November 2026) on NSL, EWL (incl. the Changi Airport branch CG), NEL, CCL, DTL and TEL.

| Field | Source | Licence |
|---|---|---|
| Station codes, English names, running order per line | LTA's published network (station codes are public facts); running order follows the code numbers with unopened numbers skipped (NS6, NE2, CC18, TE10, TE21). | Facts — not copyrightable |
| Coordinates (most stations) and Chinese names | [Wikidata](https://www.wikidata.org/) SPARQL query (`P17 = Singapore`, `P296` station code, `P625` coordinates, `zh-hant` / `zh` labels), retrieved 2026-11-10. Coordinates rounded to 4 decimals (~10 m). | **CC0 1.0** (public domain) — "All structured data … is released into the public domain" ([Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)). No attribution required; given here anyway. |
| Chinese names | Wikidata labels, converted by hand to Traditional characters (the app's `zh-Hant` locale); names Wikidata did not return were written by hand. Not yet checked character by character against LTA's own list. | CC0 1.0 |
| Coordinates the Wikidata query did not return (Napier, Orchard Boulevard, Great World, Havelock, Gardens by the Bay, Tanjong Rhu, Katong Park, Tanjong Katong, Marine Parade, Marine Terrace, Siglap, Expo/CG1, Changi Airport, Keppel, Bayfront, Cashew, Beauty World, King Albert Park, Sixth Avenue, Tan Kah Kee, Tampines West, Tampines East) | Entered by hand from public map knowledge (approximate station centres, ≤ ~150 m). They only drive the on-device "nearest station" hint and forecast-area lookup. | Facts |
| The 14 stations shipped in v1 (Tanjong Pagar … Punggol Coast) | Unchanged v1 values, hand-entered. | Facts |

**Considered and not used:** [cheeaun/sgraildata](https://github.com/cheeaun/sgraildata) has no licence file and states no licence for its code or data (checked 2026-11-10), so nothing was copied from it.

## Lines, directions and branches

File: `src/lib/network/data.ts`.

- Directions are keyed by the destination the platform board shows. Branches are separate directions where the board shows a different destination: EWL `TO_CHANGI_AIRPORT` / `TO_TANAH_MERAH` (Tanah Merah ↔ Expo ↔ Changi Airport); TEL `TO_NORTH` lists early-ending trains to Springleaf.
- **Circle Line (estimate):** Stage 6 (Keppel CC30, Cantonment CC31, Prince Edward Road CC32) opened on 2026-07-12 and Marina Bay / Bayfront were renumbered CC33 / CC34. The exact destinations the loop trains show could not be confirmed from open sources at build time, so the line is modelled as Dhoby Ghaut ↔ Prince Edward Road (via HarbourFront) plus the Prince Edward Road → Marina Bay → Bayfront → Promenade link. Where the two routes split (Promenade), sightings are not propagated. Update `LINES.CCL` when the boards are confirmed.
- Not yet open (not in the data): NS6, CC18, TE10 Mount Pleasant, TE21 Marina South, TE22A Founders' Memorial, DTL Xilin / Sungei Bedok (DT36/DT37) and TEL Bedok South / Sungei Bedok (TE30/TE31), planned for late December 2026.

## Ride and change minutes

- Ride minutes: observed figures (`RIDE_MINUTES`: EW17→EW16 3, EW15→EW17 5, TE17→TE19 3, TE17→TE2 Woodlands 37); longer observed rides are spread evenly over the stops in between that have no figure of their own; otherwise 2 min a stop including the stop itself.
- Interchange walks (platform to platform): Outram Park EW↔TE **2** (observed 0–2: the owner has made a 0-minute change), NE↔EW 3, NE↔TE 4. Everywhere else **estimates**: 3 min, or 4 at interchanges known for long walks (Dhoby Ghaut, Orchard, Tampines, Bugis, Botanic Gardens, Promenade, Newton, Woodlands, Marina Bay, HarbourFront). Changing between EWL main line and the airport branch at Tanah Merah: 3 (estimate).

## Public holidays

`PUBLIC_HOLIDAYS` in `src/lib/predict/learn.ts` (2025–2026, Ministry of Manpower list; a Sunday holiday moves to Monday). Holidays use the Sunday timetable for learning. Add each new year's dates.

## Live data (unchanged)

- LTA DataMall (`LTA_ACCOUNT_KEY`): train service alerts, platform crowd density. Terms: LTA DataMall terms of use (Singapore Open Data Licence).
- data.gov.sg 2-hour weather forecast: Singapore Open Data Licence v1.0. A station without a hand-set forecast area uses the nearest forecast area from the API's `area_metadata`.
