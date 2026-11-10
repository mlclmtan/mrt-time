/**
 * Static network data for every MRT line (NSL, EWL incl. the Changi Airport
 * branch, NEL, CCL, DTL, TEL). A line lists its directions; each direction
 * names the platform board's destination and the path(s) its trains run,
 * in running order and ending at the terminal. Branches are just more paths
 * (EWL → Changi Airport), so "which way", ride times and train propagation
 * all come from the same paths. Station coordinates and names: see
 * docs/data-sources.md.
 */
import { STATION_ROWS } from "./stations-list";

export type LineCode = "NSL" | "EWL" | "NEL" | "CCL" | "DTL" | "TEL";
export const LINE_CODE_LIST = ["NSL", "EWL", "NEL", "CCL", "DTL", "TEL"] as const satisfies readonly LineCode[];

/** Platform codes ("EW17", "CG2") and direction keys ("TO_EAST", "TO_CHANGI_AIRPORT"). */
export const PLATFORM_CODE_RE = /^[A-Z]{2}\d{1,2}$/;
export const DIRECTION_KEY_RE = /^TO_[A-Z][A-Z_]{1,30}$/;

export type Name = { en: string; "zh-Hant": string };

export type Direction = {
  key: string;
  /** Terminal platform code this direction heads towards. */
  terminal: string;
  /** Also-shown terminals (short-working trains). */
  alsoTerminals?: string[];
  label: Name;
  /** The destination exactly as the platform board shows it. */
  board: Name;
  /** Trains that end early this way (still this direction), e.g. Springleaf. */
  alsoBoard?: (Name & { terminal?: string })[];
  /** Platform codes in running order, each path ending at the terminal. */
  paths: string[][];
};

export type Line = {
  code: LineCode;
  name: Name;
  /** Official LTA line colour. */
  color: string;
  /** Service hours (SGT, minutes since midnight; end may pass 1440). */
  serviceStart: number;
  serviceEnd: number;
  directions: Record<string, Direction>;
  /** Default minutes per stop (incl. dwell) when no observed ride time exists. */
  minutesPerStop: number;
};

export type Platform = {
  code: string;
  line: LineCode;
  station: string; // station slug
  /** 1-based running order along the first path of the line that contains it. */
  order: number;
};

export type Station = {
  slug: string;
  name: Name;
  codes: string[];
  lat: number;
  lng: number;
  /** data.gov.sg 2-hour forecast area (else the nearest forecast area is used). */
  weatherArea?: string;
  exits: Name[];
  nearby: Name[];
  /** Interchange walking minutes between two of this station's platforms ("A>B"). */
  transferMin?: Record<string, number>;
  /** Transfer figures that were observed (not estimates). */
  transferObserved?: string[];
  /** Featured on the landing page (SEO). */
  seo?: boolean;
};

const n = (en: string, zh: string): Name => ({ en, "zh-Hant": zh });
const SERVICE = { serviceStart: 5 * 60 + 30, serviceEnd: 24 * 60 + 30 };

/** "NS", 1..28 → ["NS1", …] skipping unopened numbers. */
function seq(prefix: string, from: number, to: number, skip: number[] = []): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) if (!skip.includes(i)) out.push(`${prefix}${i}`);
  return out;
}
const rev = (codes: string[]) => [...codes].reverse();

// Running order (opened stations only, November 2026). Unopened: NS6 Sungei
// Kadut, NE2, CC18 Bukit Brown, TE10 Mount Pleasant, TE21 Marina South,
// TE22A Founders' Memorial, DT36/DT37 and TE30/TE31 (planned late Dec 2026).
const NS = seq("NS", 1, 28, [6]);
const EW = seq("EW", 1, 33);
const CG = ["EW4", "CG1", "CG2"];
const NE = seq("NE", 1, 18, [2]);
const DT = seq("DT", 1, 35);
const TE = seq("TE", 1, 29, [10, 21]);
/**
 * Circle Line since Stage 6 (July 2026): Dhoby Ghaut → … → HarbourFront →
 * Keppel → Cantonment → Prince Edward Road, plus the link Prince Edward
 * Road → Marina Bay (CC33, was CE2) → Bayfront (CC34, was CE1) → Promenade.
 * The exact board destinations of the loop trains could not be confirmed
 * from open sources; see docs/data-sources.md.
 */
const CC = seq("CC", 1, 32, [18]);
const CC_LINK = ["CC32", "CC33", "CC34", "CC4"];

export const LINES: Record<LineCode, Line> = {
  NSL: {
    code: "NSL",
    name: n("North–South Line", "南北線"),
    color: "#D42E12",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_MARINA_SOUTH_PIER: {
        key: "TO_MARINA_SOUTH_PIER",
        terminal: "NS28",
        label: n("To Marina South Pier", "往濱海南碼頭"),
        board: n("Marina South Pier", "濱海南碼頭"),
        paths: [NS],
      },
      TO_JURONG_EAST: {
        key: "TO_JURONG_EAST",
        terminal: "NS1",
        label: n("To Jurong East", "往裕廊東"),
        board: n("Jurong East", "裕廊東"),
        paths: [rev(NS)],
      },
    },
  },
  EWL: {
    code: "EWL",
    name: n("East–West Line", "東西線"),
    color: "#009645",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_EAST: {
        key: "TO_EAST",
        terminal: "EW1",
        label: n("To Pasir Ris", "往巴西立"),
        board: n("Pasir Ris", "巴西立"),
        paths: [rev(EW)],
      },
      TO_WEST: {
        key: "TO_WEST",
        terminal: "EW33",
        alsoTerminals: ["EW29"],
        label: n("To Joo Koon / Tuas Link", "往裕群／大士連路"),
        board: n("Joo Koon / Tuas Link", "裕群／大士連路"),
        paths: [EW],
      },
      // Changi Airport branch: its own trains between Tanah Merah and Changi Airport.
      TO_CHANGI_AIRPORT: {
        key: "TO_CHANGI_AIRPORT",
        terminal: "CG2",
        label: n("To Changi Airport", "往樟宜機場"),
        board: n("Changi Airport", "樟宜機場"),
        paths: [CG],
      },
      TO_TANAH_MERAH: {
        key: "TO_TANAH_MERAH",
        terminal: "EW4",
        label: n("To Tanah Merah", "往丹那美拉"),
        board: n("Tanah Merah", "丹那美拉"),
        paths: [rev(CG)],
      },
    },
  },
  NEL: {
    code: "NEL",
    name: n("North East Line", "東北線"),
    color: "#9900AA",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_HARBOURFRONT: {
        key: "TO_HARBOURFRONT",
        terminal: "NE1",
        label: n("To HarbourFront", "往港灣"),
        board: n("HarbourFront", "港灣"),
        paths: [rev(NE)],
      },
      TO_PUNGGOL: {
        key: "TO_PUNGGOL",
        terminal: "NE18",
        label: n("To Punggol Coast", "往榜鵝海岸"),
        board: n("Punggol Coast", "榜鵝海岸"),
        paths: [NE],
      },
    },
  },
  CCL: {
    code: "CCL",
    name: n("Circle Line", "環線"),
    color: "#FA9E0D",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_PRINCE_EDWARD_ROAD: {
        key: "TO_PRINCE_EDWARD_ROAD",
        terminal: "CC32",
        label: n("To Prince Edward Road", "往愛德華太子路"),
        board: n("Prince Edward Road", "愛德華太子路"),
        paths: [CC, rev(CC_LINK)],
      },
      TO_PROMENADE: {
        key: "TO_PROMENADE",
        terminal: "CC4",
        label: n("To Promenade via Marina Bay", "經濱海灣往寶門廊"),
        board: n("Promenade", "寶門廊"),
        paths: [CC_LINK],
      },
      TO_DHOBY_GHAUT: {
        key: "TO_DHOBY_GHAUT",
        terminal: "CC1",
        label: n("To Dhoby Ghaut", "往多美歌"),
        board: n("Dhoby Ghaut", "多美歌"),
        paths: [rev(CC)],
      },
    },
  },
  DTL: {
    code: "DTL",
    name: n("Downtown Line", "濱海市區線"),
    color: "#005EC4",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_EXPO: {
        key: "TO_EXPO",
        terminal: "DT35",
        label: n("To Expo", "往博覽"),
        board: n("Expo", "博覽"),
        paths: [DT],
      },
      TO_BUKIT_PANJANG: {
        key: "TO_BUKIT_PANJANG",
        terminal: "DT1",
        label: n("To Bukit Panjang", "往武吉班讓"),
        board: n("Bukit Panjang", "武吉班讓"),
        paths: [rev(DT)],
      },
    },
  },
  TEL: {
    code: "TEL",
    name: n("Thomson–East Coast Line", "湯申—東海岸線"),
    color: "#9D5B25",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_BAYSHORE: {
        key: "TO_BAYSHORE",
        terminal: "TE29",
        label: n("To Bayshore", "往碧灣"),
        board: n("Bayshore", "碧灣"),
        paths: [TE],
      },
      TO_NORTH: {
        key: "TO_NORTH",
        terminal: "TE1",
        alsoTerminals: ["TE4"],
        label: n("To Woodlands North", "往兀蘭北"),
        board: n("Woodlands North", "兀蘭北"),
        alsoBoard: [{ ...n("Springleaf", "春葉"), terminal: "TE4" }],
        paths: [rev(TE)],
      },
    },
  },
};

/** Two-letter code prefix → line. */
export const LINE_PREFIX: Record<string, LineCode> = {
  NS: "NSL",
  EW: "EWL",
  CG: "EWL",
  NE: "NEL",
  CC: "CCL",
  DT: "DTL",
  TE: "TEL",
};

/**
 * Hand-written details for the stations the app started with (exits, nearby
 * places, forecast area, SEO). Every other station gets its name, codes and
 * coordinates from STATION_ROWS.
 */
const DETAILS: Record<string, Partial<Station>> = {
  "tanjong-pagar": {
    weatherArea: "City",
    exits: [n("Towards Tanjong Pagar Centre", "往丹戎巴葛中心"), n("Towards Duxton Plain", "往達士嶺")],
    nearby: [n("Tanjong Pagar Centre", "丹戎巴葛中心"), n("Duxton Hill", "達士頓山"), n("Telok Ayer", "直落亞逸")],
    seo: true,
  },
  "outram-park": {
    weatherArea: "City",
    exits: [n("Towards Singapore General Hospital", "往新加坡中央醫院"), n("Towards Pearl's Hill", "往珍珠山")],
    nearby: [n("Singapore General Hospital", "新加坡中央醫院"), n("Chinatown", "牛車水"), n("Everton Park", "愛維頓園")],
    // Platform to platform at a normal pace. EW↔TE observed 0–2 min (the
    // owner has caught both trains with no wait), median 2; NE↔EW and NE↔TE
    // are longer walks (estimates).
    transferMin: { "EW16>TE17": 2, "TE17>EW16": 2, "EW16>NE3": 3, "NE3>EW16": 3, "TE17>NE3": 4, "NE3>TE17": 4 },
    transferObserved: ["EW16>TE17", "TE17>EW16"],
    seo: true,
  },
  "tiong-bahru": {
    weatherArea: "Bukit Merah",
    exits: [n("Towards Tiong Bahru Plaza", "往中峇魯廣場"), n("Towards Tiong Bahru Estate", "往中峇魯舊區")],
    nearby: [n("Tiong Bahru Market", "中峇魯巴剎"), n("Tiong Bahru Plaza", "中峇魯廣場")],
    seo: true,
  },
  redhill: {
    weatherArea: "Bukit Merah",
    exits: [n("Towards Redhill Close", "往紅山巷")],
    nearby: [n("Redhill Market", "紅山巴剎")],
    seo: true,
  },
  "pasir-ris": { weatherArea: "Pasir Ris", exits: [n("Towards White Sands", "往白沙浮購物中心")], nearby: [n("Pasir Ris Park", "巴西立公園")] },
  "joo-koon": { weatherArea: "Pioneer", exits: [n("Towards Joo Koon Circle", "往裕群圈")], nearby: [n("Fairprice Hub", "職總平價中心")] },
  "tuas-link": { weatherArea: "Tuas", exits: [n("Towards Tuas West Drive", "往大士西道")], nearby: [n("Tuas industrial estate", "大士工業區")] },
  orchard: {
    weatherArea: "Tanglin",
    exits: [n("Towards ION Orchard", "往ION Orchard"), n("Towards Wisma Atria", "往威斯馬")],
    nearby: [n("ION Orchard", "ION Orchard"), n("Ngee Ann City", "義安城")],
    seo: true,
  },
  maxwell: {
    weatherArea: "City",
    exits: [n("Towards Maxwell Food Centre", "往麥士威熟食中心")],
    nearby: [n("Maxwell Food Centre", "麥士威熟食中心"), n("Chinatown", "牛車水")],
    seo: true,
  },
  "shenton-way": {
    weatherArea: "City",
    exits: [n("Towards Shenton Way offices", "往珊頓道辦公區"), n("Towards Marina Bay", "往濱海灣")],
    nearby: [n("Lau Pa Sat", "老巴剎"), n("Marina Bay Financial Centre", "濱海灣金融中心")],
    seo: true,
  },
  "woodlands-north": { weatherArea: "Woodlands", exits: [n("Towards Woodlands Avenue 3", "往兀蘭三道")], nearby: [n("Woodlands North Coast", "兀蘭北海岸")] },
  bayshore: { weatherArea: "Bedok", exits: [n("Towards East Coast Park", "往東海岸公園")], nearby: [n("East Coast Park", "東海岸公園")] },
  harbourfront: { weatherArea: "Bukit Merah", exits: [n("Towards VivoCity", "往怡豐城")], nearby: [n("VivoCity", "怡豐城"), n("Sentosa", "聖淘沙")] },
  "punggol-coast": { weatherArea: "Punggol", exits: [n("Towards Punggol Digital District", "往榜鵝數碼園區")], nearby: [n("Punggol Digital District", "榜鵝數碼園區")] },
};

/**
 * Interchange walks (platform to platform) that are known to be long. All
 * figures here are estimates; anything not listed uses DEFAULT_TRANSFER_MIN.
 */
const LONG_TRANSFERS: Record<string, number> = {
  "dhoby-ghaut": 4,
  orchard: 4,
  tampines: 4,
  bugis: 4,
  "botanic-gardens": 4,
  promenade: 4,
  newton: 4,
  woodlands: 4,
  "marina-bay": 4,
  harbourfront: 4,
};

/**
 * Default interchange walk (estimate) when a station has no specific
 * figure. Kept ≤ 4 min: only add a larger value when a transfer is known
 * to be long.
 */
export const DEFAULT_TRANSFER_MIN = 3;
/** Changing between branches on the same platform code (Tanah Merah). Estimate. */
export const BRANCH_CHANGE_MIN = 3;

export function slugify(en: string): string {
  return en
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function transfersFor(slug: string, codes: string[]): Record<string, number> | undefined {
  if (codes.length < 2) return undefined;
  const min = LONG_TRANSFERS[slug] ?? DEFAULT_TRANSFER_MIN;
  const out: Record<string, number> = {};
  for (const a of codes) for (const b of codes) if (a !== b) out[`${a}>${b}`] = min;
  return out;
}

export const STATIONS: Station[] = STATION_ROWS.map(([codes, en, zh, lat, lng]) => {
  const slug = slugify(en);
  const list = codes.split("/");
  const extra = DETAILS[slug] ?? {};
  return {
    slug,
    name: n(en, zh || en),
    codes: list,
    lat,
    lng,
    exits: [],
    nearby: [],
    ...extra,
    transferMin: { ...transfersFor(slug, list), ...extra.transferMin },
  };
});

/**
 * Observed in-vehicle ride minutes ("A>B"). Single hops are used as is;
 * longer observed rides spread their remaining minutes evenly over the
 * stops in between that have no figure of their own.
 */
export const RIDE_MINUTES: Record<string, number> = {
  "EW17>EW16": 3,
  "EW16>EW17": 3,
  "EW15>EW17": 5,
  "EW17>EW15": 5,
  "TE17>TE19": 3,
  "TE19>TE17": 3,
  "TE17>TE2": 37,
  "TE2>TE17": 37,
};

/** Every platform, derived from station codes. */
export const PLATFORMS: Record<string, Platform> = Object.fromEntries(
  STATIONS.flatMap((station) =>
    station.codes.map((code) => {
      const match = /^([A-Z]{2})(\d+)$/.exec(code);
      const line = match ? LINE_PREFIX[match[1]] : undefined;
      if (!line) throw new Error(`Bad code ${code}`);
      const path = Object.values(LINES[line].directions)
        .flatMap((d) => d.paths)
        .find((p) => p.includes(code));
      if (!path) throw new Error(`${code} is on no path of ${line}`);
      return [code, { code, line, station: station.slug, order: path.indexOf(code) + 1 }] as const;
    }),
  ),
);
