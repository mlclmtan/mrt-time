export type ReadingSource = "owner" | "public" | "hermes";
export type ReadingStatus = "approved" | "pending" | "rejected";

/** One timed platform-board reading. Instants are Unix ms. */
export type Observation = {
  id?: number;
  station: string; // platform code, e.g. "EW17"
  line: string;
  direction: string;
  destination?: string | null;
  capturedAt: number;
  /** Minutes shown for the next, next-next and optional third train. */
  minutes: number[];
  source: ReadingSource;
  status: ReadingStatus;
};

export type Confidence = "high" | "medium" | "low";
export type Basis = "same_day" | "historical" | "band" | "closed" | "none";

export type ReasonCode =
  | "reading_ago" // { minutes }
  | "boarded_ago" // { minutes } someone boarded / got off a train here
  | "seen_elsewhere" // { station, minutes, hops } the same train seen at another station
  | "historical_anchor" // { clock, date (SGT "YYYY-MM-DD"), gap }
  | "repeats" // { days } clock times repeated on recent days
  | "observed_gap" // { headway, count }
  | "typical_gap" // { headway }
  | "unstable_window" // { headway }
  | "not_running";

export type Arrival = {
  at: number;
  inMin: number;
  /**
   * Same-day trains only: ± minutes on this arrival. 0 = exact (a known
   * train, or within 2 gaps of one, with ≤ 1 min error); otherwise shown as
   * "≈HH:MM ±N" — the band widens with every gap further from what was seen.
   */
  errMin?: number;
};

export type Prediction = {
  /** "times" = clock arrivals; "range" = every ~N min, wait between bounds. */
  kind: "times" | "range" | "closed";
  arrivals: Arrival[];
  headwayMin: number;
  /** For ranges: the wait you should expect, in minutes. */
  waitMin: { min: number; max: number };
  confidence: Confidence;
  basis: Basis;
  reason: { code: ReasonCode; params: Record<string, string | number> };
  band: TimeBandKey;
  unstable: boolean;
  anchorAt?: number;
  /** Largest whole-minute ± among the shown same-day arrivals (0 = all exact). */
  spreadMin?: number;
  /** What the same-day times are based on. */
  anchorKind?: "board_reading" | "boarded" | "alighted";
  /** Platform where that train was seen (when it was another station). */
  anchorStation?: string;
  /** Learned day-to-day behaviour of this half hour at this platform. */
  stability?: "repeats" | "drifts" | "unknown";
};

export type TimeBandKey = "weekday_am_peak" | "weekday_pm_peak" | "weekday_offpeak" | "weekend";

/** An editable window where clock times don't repeat day to day. */
export type UnstableWindow = {
  dayType: "weekday" | "weekend" | "all";
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  line?: string | null;
  note?: string;
};
