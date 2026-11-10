# Data sources and licences

Everything below is static data shipped in the repo (`src/lib/network/`). No paid APIs.

## Stations (names, codes, coordinates)

File: `src/lib/network/stations-list.ts` — 146 open MRT stations (November 2026) on NSL, EWL (incl. the Changi Airport branch CG), NEL, CCL, DTL and TEL.

| Field | Source | Licence |
|---|---|---|
| Station codes, English names, running order per line | LTA's published network (station codes are public facts). Since v2.1 every direction's stops are written out one by one in `data.ts` (never generated from code numbers): numbering has real gaps (NS6, NE2, CC18, TE10, TE21) and branch codes don't follow the trunk (CG1/CG2 leave the EWL at EW4; CC33/CC34 were CE2/CE1). | Facts — not copyrightable |
| Coordinates (most stations) and Chinese names | [Wikidata](https://www.wikidata.org/) SPARQL query (`P17 = Singapore`, `P296` station code, `P625` coordinates, `zh-hant` / `zh` labels), retrieved 2026-11-10. Coordinates rounded to 4 decimals (~10 m). | **CC0 1.0** (public domain) — "All structured data … is released into the public domain" ([Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)). No attribution required; given here anyway. |
| Chinese names | Wikidata labels, converted by hand to Traditional characters (the app's `zh-Hant` locale); names Wikidata did not return were written by hand. A test (`network.test.ts`) rejects Simplified-only characters in every station, line and board name. v2.2 checked the hand-written and newest names against LTA's official list — see "Chinese names: checked against official sources" below. | CC0 1.0 (Wikidata); LTA names are facts |
| Coordinates the Wikidata query did not return (Napier, Orchard Boulevard, Great World, Havelock, Gardens by the Bay, Tanjong Rhu, Katong Park, Tanjong Katong, Marine Parade, Marine Terrace, Siglap, Expo/CG1, Changi Airport, Keppel, Bayfront, Cashew, Beauty World, King Albert Park, Sixth Avenue, Tan Kah Kee, Tampines West, Tampines East) | Entered by hand from public map knowledge (approximate station centres, ≤ ~150 m). They only drive the on-device "nearest station" hint and forecast-area lookup. | Facts |
| The 14 stations shipped in v1 (Tanjong Pagar … Punggol Coast) | Unchanged v1 values, hand-entered. | Facts |

### Chinese names: checked against official sources (v2.2, 2026-11-10)

All 146 names are in Traditional characters (automated test since v2.1). In v2.2 the 32 names most likely to differ (hand-written or recently opened) plus the Circle Line names the app shows were compared with official Simplified names, converted to Traditional the standard (OpenCC s2t) way — e.g. 弯→彎, 湾→灣, 兰→蘭, 乐→樂; 台 stays 台.

Sources:
- **Official:** LTA, "Train Station Chinese Names" dataset on data.gov.sg (resource `d_d312a5b127e1ae74299b8ae664cedd4e`, dated June 2017 — covers stations up to Downtown Line stage 2; no TEL, Hume, Keppel / Cantonment / Prince Edward Road or Punggol Coast). Singapore Open Data Licence.
- **Secondary:** Chinese Wikipedia, 新加坡地铁车站列表 and 汤申—东海岸线 (the latter cites LTA's 2014 station-naming release and Lianhe Zaobao); zh.wikipedia's article on Cantonment station for Keppel / Cantonment / Prince Edward Road. Zaobao, 8world, SMRT / SBS Transit Chinese maps and LTA DataMall's newer "Train Station Codes and Chinese Names" file could not be read from the build environment.

Result: **one correction** — Tuas Crescent is 大士弯 → **大士彎** (a bend), not 大士灣 (a bay). Every other checked name matches.

| Status | Names |
|---|---|
| Confirmed against LTA's official list | Cashew 凱秀 · Hillview 山景 · King Albert Park 阿爾柏王園 · Gul Circle 卡爾圈 · Tuas Crescent 大士彎 (corrected) · Tuas West Road 大士西路 · Tuas Link 大士連路 · Bayfront 海灣舫 · Promenade 寶門廊 · Dhoby Ghaut 多美歌 · HarbourFront 港灣 · Marina Bay 濱海灣 · Circle Line 環線 |
| **Still unverified** against an official source (Chinese Wikipedia agrees; no conflict found) | Hume 謙道 · Punggol Coast 榜鵝海岸 · Keppel 吉寶 · Cantonment 廣東民 · Prince Edward Road 愛德華太子路 · Woodlands North 兀蘭北 · Woodlands South 兀蘭南 · Springleaf 春葉 · Lentor 倫多 · Mayflower 美華 · Bright Hill 光明山 · Upper Thomson 湯申路上段 · Napier 納比雅 · Orchard Boulevard 烏節大道 · Great World 大世界 · Havelock 合樂 · Gardens by the Bay 濱海灣花園 · Tanjong Rhu 丹戎禺 · Katong Park 加東公園 · Tanjong Katong 丹戎加東 · Marine Parade 馬林百列 · Marine Terrace 馬林台 · Siglap 實乞納 · Bayshore 碧灣 |
| Unverified wording (our translation) | Circle Line directions 順時針 "Clockwise" / 逆時針 "Anticlockwise": no Chinese screen text was found in any source |

Next check: LTA DataMall's "Train Station Codes and Chinese Names" (updated January 2025) covers the TEL and newer stations.

### Exits, nearby places, forecast areas

Only the 14 stations shipped in v1 have hand-written exits / nearby places / a forecast area. Every other station leaves these fields out (they are optional) rather than inventing them; the forecast falls back to the nearest data.gov.sg area.

**Considered and not used:** [cheeaun/sgraildata](https://github.com/cheeaun/sgraildata) has no licence file and states no licence for its code or data (checked 2026-11-10), so nothing was copied from it.

## Lines, directions and branches

File: `src/lib/network/data.ts`.

- Directions are keyed by the destination the platform board shows. Branches are separate directions where the board shows a different destination: EWL `TO_CHANGI_AIRPORT` / `TO_TANAH_MERAH` (Tanah Merah ↔ Expo ↔ Changi Airport); TEL `TO_NORTH` lists early-ending trains to Springleaf. The Circle Line is the exception: its loop has no destination, so its two directions are the screen's "Clockwise" / "Anticlockwise" (below).
- **Circle Line (v2.2, checked 2026-11-10):** Stage 6 (Keppel CC30, Cantonment CC31, Prince Edward Road CC32) opened to passengers on **12 July 2026** (public preview 4 July), and Marina Bay / Bayfront became CC33 / CC34 (were CE2 / CE1).
  - **Service pattern:** a full loop run **clockwise** and **anticlockwise** all day (about 75 min round; every ~2 min at peaks, 5–6 min off-peak). A **spur** service runs Dhoby Ghaut ↔ Prince Edward Road via Bishan at weekday peaks (clockwise trains end at Dhoby Ghaut, anticlockwise at Prince Edward Road); off-peak and at weekends it is a **Dhoby Ghaut ↔ Stadium shuttle** (Dhoby Ghaut, Bras Basah, Esplanade, Promenade, Nicoll Highway, Stadium). Late-night short trips end at Tai Seng, Caldecott, one-north, Pasir Panjang (anticlockwise) and Mountbatten, Bartley, Marina Bay (clockwise) — not modelled.
  - **Platform screens:** since 2 July 2026 "Clockwise" / "Anticlockwise" appear in small type and the **next interchange station** in large type for loop trains; trains that terminate show "ends at Dhoby Ghaut" etc. ("Loop" and the circular icon were dropped; "inner / outer loop" was rejected in LTA's 2025 survey.)
  - **In the app** (`LINES.CCL`, keys frozen): `TO_PRINCE_EDWARD_ROAD` is anticlockwise (codes going up; board "Anticlockwise", also ends Prince Edward Road / Stadium) and `TO_DHOBY_GHAUT` clockwise (board "Clockwise", also ends Dhoby Ghaut); each has the spur as a path and the loop CC4 → … → CC34 → CC4 as `loop`. Because the next-interchange name changes along the line, the board name is the direction word, not a station. v2.1's `TO_PROMENADE` ("Promenade via Marina Bay" — anticlockwise) is retired; stored rows are read as anticlockwise, and v2.1 "To Prince Edward Road" rows at Marina Bay / Bayfront as clockwise (`LEGACY_DIRECTIONS`).
  - **Sources:** [LTA news release, 14 May 2026](https://www.lta.gov.sg/content/ltagov/en/newsroom/2026/5/news-releases/circle-line-stage-6-to-open-for-public-preview-on-4-july-2026.html) (dates); [LTA media reply, 20 Aug 2026](https://www.lta.gov.sg/content/ltagov/en/newsroom/2026/8/media-replies/circle-line-wayfinding-continues-to-be-refined.html) (screens emphasise the next interchange or terminating station; still being refined); [Mothership, 2 Jul 2026](https://mothership.sg/2026/07/lta-circle-line-signs-changes/) (revised screen format); [Stomp, 29 May 2026](https://www.stomp.sg/trending-now/circle-lines-new-clockwise-anticlockwise-wayfinding-signs-leave-some-commuters-confused) (preview signs "Clockwise … via Bayfront" / "Anticlockwise … via Paya Lebar"); [Land Transport Guru, CCL6 opening (14 Jul 2026)](https://landtransportguru.net/circle-line-6-opening/) and [CCL page](https://landtransportguru.net/train/ccl/) (service pattern, spur, shuttle, short trips); [MOT written reply, 7 Jan 2025](https://www.mot.gov.sg/news-resources/newsroom/written-reply-to-parliamentary-question-on-service-pattern-along-circle-line-once-stage-6-is-completed/) (pattern then under review).
  - **Not confirmed:** the off-peak Stadium shuttle comes from Land Transport Guru only (no LTA / SMRT page found); exact live screen strings (whether "via" is still shown); any Chinese screen wording (順時針 / 逆時針 is our translation); on-train displays. LTA's wayfinding FAQ PDF returned 404.
- Not yet open (not in the data): NS6, CC18, TE10 Mount Pleasant, TE21 Marina South, TE22A Founders' Memorial, DTL Xilin / Sungei Bedok (DT36/DT37) and TEL Bedok South / Sungei Bedok (TE30/TE31), planned for late December 2026.

## Ride and change minutes

- Ride minutes: observed figures (`RIDE_MINUTES`: EW17→EW16 3, EW15→EW17 5, TE17→TE19 3, TE17→TE2 Woodlands 37); longer observed rides are spread evenly over the stops in between that have no figure of their own; otherwise 2 min a stop including the stop itself.
- Interchange walks (platform to platform): Outram Park EW↔TE **2** (observed 0–2: the owner has made a 0-minute change), NE↔EW 3, NE↔TE 4. Everywhere else **estimates**: 3 min, or 4 at interchanges known for long walks (Dhoby Ghaut, Orchard, Tampines, Bugis, Botanic Gardens, Promenade, Newton, Woodlands, Marina Bay, HarbourFront). Changing between EWL main line and the airport branch at Tanah Merah: 3 (estimate).

## Public holidays

`PUBLIC_HOLIDAYS` in `src/lib/predict/learn.ts`: 2025–2027 from the Ministry of Manpower list (https://www.mom.gov.sg/employment-practices/public-holidays, checked 2026-11-10; it lists both 2026 and 2027). A Sunday holiday's Monday in lieu is included. For learning, a date counts as Sunday/public holiday **only when it is in this list**; any date not listed (e.g. 2028 until added) is treated by its weekday. Add each new year's dates when MOM publishes them.

## Live data (unchanged)

- LTA DataMall (`LTA_ACCOUNT_KEY`): train service alerts, platform crowd density. Terms: LTA DataMall terms of use (Singapore Open Data Licence).
- data.gov.sg 2-hour weather forecast: Singapore Open Data Licence v1.0. A station without a hand-set forecast area uses the nearest forecast area from the API's `area_metadata`.
