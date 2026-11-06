/**
 * Static network data. Structured so the whole MRT network can be added
 * later: a line lists its platforms in running order (`order`), a station
 * groups the platform codes that share one building (interchanges), and a
 * direction is keyed by the terminal it heads towards.
 */
export type LineCode = "EWL" | "TEL" | "NEL";

export type Direction = {
  key: string;
  /** Terminal platform code this direction heads towards. */
  terminal: string;
  /** Also-shown terminals (short-working trains, branch ends). */
  alsoTerminals?: string[];
  /** +1 when running towards higher `order`, −1 towards lower. */
  sense: 1 | -1;
  label: { en: string; "zh-Hant": string };
  /** The destination exactly as the platform board shows it. */
  board: { en: string; "zh-Hant": string };
  /** Trains that end early this way (still this direction), e.g. Springleaf. */
  alsoBoard?: { en: string; "zh-Hant": string }[];
};

export type Line = {
  code: LineCode;
  name: { en: string; "zh-Hant": string };
  /** Official LTA line colour. */
  color: string;
  /** Service hours (SGT, minutes since midnight; end may pass 1440). */
  serviceStart: number;
  serviceEnd: number;
  directions: Record<string, Direction>;
  /** Default minutes per stop when no observed ride time exists. */
  minutesPerStop: number;
};

export type Platform = {
  code: string;
  line: LineCode;
  station: string; // station slug
  /** Running order on the line (the official number for these lines). */
  order: number;
};

export type Station = {
  slug: string;
  name: { en: string; "zh-Hant": string };
  codes: string[];
  lat: number;
  lng: number;
  /** data.gov.sg 2-hour forecast area for rain hints. */
  weatherArea: string;
  exits: { en: string; "zh-Hant": string }[];
  nearby: { en: string; "zh-Hant": string }[];
  /** Interchange walking minutes between two of this station's platforms. */
  transferMin?: Record<string, number>;
  /** Shown on the station page (SEO). */
  seo?: boolean;
};

const SERVICE = { serviceStart: 5 * 60 + 30, serviceEnd: 24 * 60 + 30 };

export const LINES: Record<LineCode, Line> = {
  EWL: {
    code: "EWL",
    name: { en: "East–West Line", "zh-Hant": "東西線" },
    color: "#009645",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_EAST: {
        key: "TO_EAST",
        terminal: "EW1",
        sense: -1,
        label: { en: "To Pasir Ris", "zh-Hant": "往巴西立" },
        board: { en: "Pasir Ris", "zh-Hant": "巴西立" },
      },
      TO_WEST: {
        key: "TO_WEST",
        terminal: "EW33",
        alsoTerminals: ["EW29"],
        sense: 1,
        label: { en: "To Joo Koon / Tuas Link", "zh-Hant": "往裕群／大士連路" },
        board: { en: "Joo Koon / Tuas Link", "zh-Hant": "裕群／大士連路" },
      },
    },
  },
  TEL: {
    code: "TEL",
    name: { en: "Thomson–East Coast Line", "zh-Hant": "湯申—東海岸線" },
    color: "#9D5B25",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_BAYSHORE: {
        key: "TO_BAYSHORE",
        terminal: "TE29",
        sense: 1,
        label: { en: "To Bayshore", "zh-Hant": "往碧灣" },
        board: { en: "Bayshore", "zh-Hant": "碧灣" },
      },
      TO_NORTH: {
        key: "TO_NORTH",
        terminal: "TE1",
        alsoTerminals: ["TE4"],
        sense: -1,
        label: { en: "To Woodlands North", "zh-Hant": "往兀蘭北" },
        board: { en: "Woodlands North", "zh-Hant": "兀蘭北" },
        alsoBoard: [{ en: "Springleaf", "zh-Hant": "春葉" }],
      },
    },
  },
  NEL: {
    code: "NEL",
    name: { en: "North East Line", "zh-Hant": "東北線" },
    color: "#9900AA",
    ...SERVICE,
    minutesPerStop: 2,
    directions: {
      TO_HARBOURFRONT: {
        key: "TO_HARBOURFRONT",
        terminal: "NE1",
        sense: -1,
        label: { en: "To HarbourFront", "zh-Hant": "往港灣" },
        board: { en: "HarbourFront", "zh-Hant": "港灣" },
      },
      TO_PUNGGOL: {
        key: "TO_PUNGGOL",
        terminal: "NE18",
        sense: 1,
        label: { en: "To Punggol Coast", "zh-Hant": "往榜鵝海岸" },
        board: { en: "Punggol Coast", "zh-Hant": "榜鵝海岸" },
      },
    },
  },
};

const n = (en: string, zh: string) => ({ en, "zh-Hant": zh });

export const STATIONS: Station[] = [
  {
    slug: "tanjong-pagar",
    name: n("Tanjong Pagar", "丹戎巴葛"),
    codes: ["EW15"],
    lat: 1.2764,
    lng: 103.8458,
    weatherArea: "City",
    exits: [n("Towards Tanjong Pagar Centre", "往丹戎巴葛中心"), n("Towards Duxton Plain", "往達士嶺")],
    nearby: [n("Tanjong Pagar Centre", "丹戎巴葛中心"), n("Duxton Hill", "達士頓山"), n("Telok Ayer", "直落亞逸")],
    seo: true,
  },
  {
    slug: "outram-park",
    name: n("Outram Park", "歐南園"),
    codes: ["EW16", "TE17", "NE3"],
    lat: 1.2803,
    lng: 103.8395,
    weatherArea: "City",
    exits: [n("Towards Singapore General Hospital", "往新加坡中央醫院"), n("Towards Pearl's Hill", "往珍珠山")],
    nearby: [n("Singapore General Hospital", "新加坡中央醫院"), n("Chinatown", "牛車水"), n("Everton Park", "愛維頓園")],
    // Estimates (platform to platform, walking at a normal pace). EW↔TE is
    // observed at 1–2 min (median 2); NE↔EW and NE↔TE are longer walks.
    transferMin: { "EW16>TE17": 2, "TE17>EW16": 2, "EW16>NE3": 3, "NE3>EW16": 3, "TE17>NE3": 4, "NE3>TE17": 4 },
    seo: true,
  },
  {
    slug: "tiong-bahru",
    name: n("Tiong Bahru", "中峇魯"),
    codes: ["EW17"],
    lat: 1.2862,
    lng: 103.827,
    weatherArea: "Bukit Merah",
    exits: [n("Towards Tiong Bahru Plaza", "往中峇魯廣場"), n("Towards Tiong Bahru Estate", "往中峇魯舊區")],
    nearby: [n("Tiong Bahru Market", "中峇魯巴剎"), n("Tiong Bahru Plaza", "中峇魯廣場")],
    seo: true,
  },
  {
    slug: "redhill",
    name: n("Redhill", "紅山"),
    codes: ["EW18"],
    lat: 1.2896,
    lng: 103.8168,
    weatherArea: "Bukit Merah",
    exits: [n("Towards Redhill Close", "往紅山巷")],
    nearby: [n("Redhill Market", "紅山巴剎")],
    seo: true,
  },
  {
    slug: "pasir-ris",
    name: n("Pasir Ris", "巴西立"),
    codes: ["EW1"],
    lat: 1.373,
    lng: 103.9493,
    weatherArea: "Pasir Ris",
    exits: [n("Towards White Sands", "往白沙浮購物中心")],
    nearby: [n("Pasir Ris Park", "巴西立公園")],
  },
  {
    slug: "joo-koon",
    name: n("Joo Koon", "裕群"),
    codes: ["EW29"],
    lat: 1.3277,
    lng: 103.6783,
    weatherArea: "Pioneer",
    exits: [n("Towards Joo Koon Circle", "往裕群圈")],
    nearby: [n("Fairprice Hub", "職總平價中心")],
  },
  {
    slug: "tuas-link",
    name: n("Tuas Link", "大士連路"),
    codes: ["EW33"],
    lat: 1.3404,
    lng: 103.6368,
    weatherArea: "Tuas",
    exits: [n("Towards Tuas West Drive", "往大士西道")],
    nearby: [n("Tuas industrial estate", "大士工業區")],
  },
  {
    slug: "orchard",
    name: n("Orchard", "烏節"),
    codes: ["TE14"],
    lat: 1.3043,
    lng: 103.8324,
    weatherArea: "Tanglin",
    exits: [n("Towards ION Orchard", "往ION Orchard"), n("Towards Wisma Atria", "往威斯馬")],
    nearby: [n("ION Orchard", "ION Orchard"), n("Ngee Ann City", "義安城")],
    seo: true,
  },
  {
    slug: "maxwell",
    name: n("Maxwell", "麥士威"),
    codes: ["TE18"],
    lat: 1.2806,
    lng: 103.8441,
    weatherArea: "City",
    exits: [n("Towards Maxwell Food Centre", "往麥士威熟食中心")],
    nearby: [n("Maxwell Food Centre", "麥士威熟食中心"), n("Chinatown", "牛車水")],
    seo: true,
  },
  {
    slug: "shenton-way",
    name: n("Shenton Way", "珊頓道"),
    codes: ["TE19"],
    lat: 1.2777,
    lng: 103.8502,
    weatherArea: "City",
    exits: [n("Towards Shenton Way offices", "往珊頓道辦公區"), n("Towards Marina Bay", "往濱海灣")],
    nearby: [n("Lau Pa Sat", "老巴剎"), n("Marina Bay Financial Centre", "濱海灣金融中心")],
    seo: true,
  },
  {
    slug: "woodlands-north",
    name: n("Woodlands North", "兀蘭北"),
    codes: ["TE1"],
    lat: 1.4482,
    lng: 103.7856,
    weatherArea: "Woodlands",
    exits: [n("Towards Woodlands Avenue 3", "往兀蘭三道")],
    nearby: [n("Woodlands North Coast", "兀蘭北海岸")],
  },
  {
    slug: "bayshore",
    name: n("Bayshore", "碧灣"),
    codes: ["TE29"],
    lat: 1.3135,
    lng: 103.9418,
    weatherArea: "Bedok",
    exits: [n("Towards East Coast Park", "往東海岸公園")],
    nearby: [n("East Coast Park", "東海岸公園")],
  },
  {
    slug: "harbourfront",
    name: n("HarbourFront", "港灣"),
    codes: ["NE1"],
    lat: 1.2653,
    lng: 103.822,
    weatherArea: "Bukit Merah",
    exits: [n("Towards VivoCity", "往怡豐城")],
    nearby: [n("VivoCity", "怡豐城"), n("Sentosa", "聖淘沙")],
  },
  {
    slug: "punggol-coast",
    name: n("Punggol Coast", "榜鵝海岸"),
    codes: ["NE18"],
    lat: 1.4155,
    lng: 103.9107,
    weatherArea: "Punggol",
    exits: [n("Towards Punggol Digital District", "往榜鵝數碼園區")],
    nearby: [n("Punggol Digital District", "榜鵝數碼園區")],
  },
];

/** Observed in-vehicle ride minutes ("A>B"), used before the per-stop default. */
export const RIDE_MINUTES: Record<string, number> = {
  "EW17>EW16": 3,
  "EW16>EW17": 3,
  "TE17>TE19": 3,
  "TE19>TE17": 3,
  "EW15>EW17": 5,
  "EW17>EW15": 5,
};

/**
 * Default interchange walk (estimate) when a station has no specific
 * figure. Kept ≤ 4 min: only add a larger per-station value when a
 * transfer is known to be long.
 */
export const DEFAULT_TRANSFER_MIN = 3;

const LINE_PREFIX: Record<string, LineCode> = { EW: "EWL", TE: "TEL", NE: "NEL" };

/** Every platform, derived from station codes. */
export const PLATFORMS: Record<string, Platform> = Object.fromEntries(
  STATIONS.flatMap((station) =>
    station.codes.map((code) => {
      const match = /^([A-Z]{2})(\d+)$/.exec(code);
      if (!match || !LINE_PREFIX[match[1]]) throw new Error(`Bad code ${code}`);
      return [
        code,
        { code, line: LINE_PREFIX[match[1]], station: station.slug, order: Number(match[2]) },
      ] as const;
    }),
  ),
);
