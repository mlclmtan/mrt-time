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
  /**
   * A loop this direction's trains can run all the way round (no terminal),
   * in running order; the last code runs on to the first. Circle Line since
   * Stage 6. Spur trains that do end somewhere are still `paths`.
   */
  loop?: string[];
  /**
   * No longer offered (no platform serves it, new rows are refused). Kept
   * only so the frozen key still exists; stored rows are read as the
   * current direction (`LEGACY_DIRECTIONS`).
   */
  retired?: true;
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
  /** Hand-sourced only (the v1 stations); absent elsewhere — never invented. */
  exits?: Name[];
  nearby?: Name[];
  /** Interchange walking minutes between two of this station's platforms ("A>B"). */
  transferMin?: Record<string, number>;
  /** Transfer figures that were observed (not estimates). */
  transferObserved?: string[];
  /** Featured on the landing page (SEO). */
  seo?: boolean;
};

const n = (en: string, zh: string): Name => ({ en, "zh-Hant": zh });
const SERVICE = { serviceStart: 5 * 60 + 30, serviceEnd: 24 * 60 + 30 };

const rev = (codes: readonly string[]) => [...codes].reverse();

/*
 * Running order, written out stop by stop (opened stations only, November
 * 2026). Never derived from code numbers: numbering has gaps (NS6 Sungei
 * Kadut, NE2, CC18 Bukit Brown, TE10 Mount Pleasant, TE21 Marina South,
 * TE22A Founders' Memorial; DT36/DT37 and TE30/TE31 open late Dec 2026),
 * and branch codes don't follow the trunk (CG1/CG2 leave the EWL at EW4;
 * CC33/CC34 were CE2/CE1). network.test.ts checks every list.
 */
const NS = [
  "NS1", "NS2", "NS3", "NS4", "NS5", "NS7", "NS8", "NS9", "NS10", "NS11", "NS12", "NS13", "NS14", "NS15",
  "NS16", "NS17", "NS18", "NS19", "NS20", "NS21", "NS22", "NS23", "NS24", "NS25", "NS26", "NS27", "NS28",
] as const;
const EW = [
  "EW1", "EW2", "EW3", "EW4", "EW5", "EW6", "EW7", "EW8", "EW9", "EW10", "EW11", "EW12", "EW13", "EW14", "EW15", "EW16", "EW17",
  "EW18", "EW19", "EW20", "EW21", "EW22", "EW23", "EW24", "EW25", "EW26", "EW27", "EW28", "EW29", "EW30", "EW31", "EW32", "EW33",
] as const;
/** Changi Airport branch: Tanah Merah (EW4) → Expo (CG1) → Changi Airport (CG2). */
const CG = ["EW4", "CG1", "CG2"] as const;
const NE = ["NE1", "NE3", "NE4", "NE5", "NE6", "NE7", "NE8", "NE9", "NE10", "NE11", "NE12", "NE13", "NE14", "NE15", "NE16", "NE17", "NE18"] as const;
const DT = [
  "DT1", "DT2", "DT3", "DT4", "DT5", "DT6", "DT7", "DT8", "DT9", "DT10", "DT11", "DT12", "DT13", "DT14", "DT15", "DT16", "DT17", "DT18",
  "DT19", "DT20", "DT21", "DT22", "DT23", "DT24", "DT25", "DT26", "DT27", "DT28", "DT29", "DT30", "DT31", "DT32", "DT33", "DT34", "DT35",
] as const;
const TE = [
  "TE1", "TE2", "TE3", "TE4", "TE5", "TE6", "TE7", "TE8", "TE9", "TE11", "TE12", "TE13", "TE14", "TE15",
  "TE16", "TE17", "TE18", "TE19", "TE20", "TE22", "TE23", "TE24", "TE25", "TE26", "TE27", "TE28", "TE29",
] as const;
/**
 * Circle Line since Stage 6 (12 July 2026; see docs/data-sources.md): a
 * full loop, run clockwise and anticlockwise, plus a spur.
 * Anticlockwise = codes going up: Promenade → Stadium → Paya Lebar → Bishan
 * → Buona Vista → HarbourFront → Keppel → Cantonment → Prince Edward Road →
 * Marina Bay (CC33, was CE2) → Bayfront (CC34, was CE1) → Promenade.
 * The spur (Dhoby Ghaut → Bras Basah → Esplanade → Promenade) runs on round
 * the loop to Prince Edward Road at weekday peaks ("ends at Prince Edward
 * Road" / "ends at Dhoby Ghaut"); off-peak it is a Dhoby Ghaut ↔ Stadium
 * shuttle.
 */
const CC_LOOP = [
  "CC4", "CC5", "CC6", "CC7", "CC8", "CC9", "CC10", "CC11", "CC12", "CC13", "CC14", "CC15", "CC16", "CC17", "CC19", "CC20",
  "CC21", "CC22", "CC23", "CC24", "CC25", "CC26", "CC27", "CC28", "CC29", "CC30", "CC31", "CC32", "CC33", "CC34",
] as const;
/** Spur trains: Dhoby Ghaut … Promenade, then anticlockwise to Prince Edward Road. */
const CC_SPUR = [
  "CC1", "CC2", "CC3", "CC4", "CC5", "CC6", "CC7", "CC8", "CC9", "CC10", "CC11", "CC12", "CC13", "CC14", "CC15", "CC16",
  "CC17", "CC19", "CC20", "CC21", "CC22", "CC23", "CC24", "CC25", "CC26", "CC27", "CC28", "CC29", "CC30", "CC31", "CC32",
] as const;
/** v2.1's Prince Edward Road → Marina Bay → Bayfront → Promenade link (retired TO_PROMENADE). */
const CC_LINK_V21 = ["CC32", "CC33", "CC34", "CC4"] as const;
/** Path literal → mutable copy (each direction owns its arrays). */
const path = (codes: readonly string[]) => [...codes];

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
        paths: [path(NS)],
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
        paths: [path(EW)],
      },
      // Changi Airport branch: its own trains between Tanah Merah and Changi Airport.
      TO_CHANGI_AIRPORT: {
        key: "TO_CHANGI_AIRPORT",
        terminal: "CG2",
        label: n("To Changi Airport", "往樟宜機場"),
        board: n("Changi Airport", "樟宜機場"),
        paths: [path(CG)],
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
        paths: [path(NE)],
      },
    },
  },
  CCL: {
    code: "CCL",
    name: n("Circle Line", "環線"),
    color: "#FA9E0D",
    ...SERVICE,
    minutesPerStop: 2,
    // Keys are frozen (stored rows): TO_PRINCE_EDWARD_ROAD is now the
    // anticlockwise direction, TO_DHOBY_GHAUT the clockwise one. Platform
    // screens show "Clockwise" / "Anticlockwise" small with the next
    // interchange in large type, or "ends at …" for spur / shuttle trains.
    directions: {
      TO_PRINCE_EDWARD_ROAD: {
        key: "TO_PRINCE_EDWARD_ROAD",
        terminal: "CC32",
        alsoTerminals: ["CC6"],
        label: n("Anticlockwise", "逆時針"),
        board: n("Anticlockwise", "逆時針"),
        alsoBoard: [
          { ...n("Prince Edward Road", "愛德華太子路"), terminal: "CC32" },
          { ...n("Stadium", "體育場"), terminal: "CC6" },
        ],
        paths: [path(CC_SPUR)],
        loop: path(CC_LOOP),
      },
      TO_DHOBY_GHAUT: {
        key: "TO_DHOBY_GHAUT",
        terminal: "CC1",
        label: n("Clockwise", "順時針"),
        board: n("Clockwise", "順時針"),
        alsoBoard: [{ ...n("Dhoby Ghaut", "多美歌"), terminal: "CC1" }],
        paths: [rev(CC_SPUR)],
        loop: rev(CC_LOOP),
      },
      TO_PROMENADE: {
        key: "TO_PROMENADE",
        terminal: "CC4",
        label: n("To Promenade via Marina Bay", "經濱海灣往寶門廊"),
        board: n("Promenade", "寶門廊"),
        paths: [path(CC_LINK_V21)],
        retired: true,
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
        paths: [path(DT)],
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
        paths: [path(TE)],
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

/**
 * Stored rows whose direction key meant something else before v2.2, read as
 * the current direction. v2.1 modelled the Circle Line's Marina Bay section
 * as a "To Promenade" link (Prince Edward Road → Marina Bay → Bayfront →
 * Promenade: anticlockwise), and "To Prince Edward Road" at Marina Bay /
 * Bayfront as trains heading back to Prince Edward Road (clockwise).
 */
export const LEGACY_DIRECTIONS: readonly { line: LineCode; key: string; stations?: readonly string[]; into: string }[] = [
  { line: "CCL", key: "TO_PROMENADE", into: "TO_PRINCE_EDWARD_ROAD" },
  { line: "CCL", key: "TO_PRINCE_EDWARD_ROAD", stations: ["CC33", "CC34"], into: "TO_DHOBY_GHAUT" },
];

/** Every platform, derived from station codes. */
export const PLATFORMS: Record<string, Platform> = Object.fromEntries(
  STATIONS.flatMap((station) =>
    station.codes.map((code) => {
      const match = /^([A-Z]{2})(\d+)$/.exec(code);
      const line = match ? LINE_PREFIX[match[1]] : undefined;
      if (!line) throw new Error(`Bad code ${code}`);
      const path = Object.values(LINES[line].directions)
        .filter((d) => !d.retired)
        .flatMap((d) => [...d.paths, ...(d.loop ? [d.loop] : [])])
        .find((p) => p.includes(code));
      if (!path) throw new Error(`${code} is on no path of ${line}`);
      return [code, { code, line, station: station.slug, order: path.indexOf(code) + 1 }] as const;
    }),
  ),
);
