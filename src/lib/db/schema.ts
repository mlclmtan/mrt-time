import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-generated";

export * from "./auth-generated";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ---------------- Network observations & owner logs ---------------- */

/** One platform-board reading. Minutes for next / next-next / 3rd train. */
export const observation = pgTable(
  "observation",
  {
    id: serial("id").primaryKey(),
    station: text("station").notNull(), // platform code, e.g. EW17
    line: text("line").notNull(),
    direction: text("direction").notNull(),
    destination: text("destination"),
    capturedAt: ts("captured_at").notNull(),
    minutes: integer("minutes").array().notNull(),
    source: text("source").notNull(), // owner | public | hermes
    status: text("status").notNull().default("pending"), // approved | pending | rejected
    /** Free-form provenance from the owner/Hermes ("typed", "photo"); never public text. */
    origin: text("origin"),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    deviceId: text("device_id"),
    ipHash: text("ip_hash"),
    createdAt: ts("created_at").notNull().defaultNow(),
    reviewedAt: ts("reviewed_at"),
  },
  (t) => [
    index("observation_platform_idx").on(t.station, t.line, t.direction, t.capturedAt),
    index("observation_line_idx").on(t.line, t.direction, t.capturedAt),
    index("observation_status_idx").on(t.status, t.createdAt),
    uniqueIndex("observation_dedupe_idx").on(t.station, t.line, t.direction, t.capturedAt, t.source),
  ],
);

export const place = pgTable(
  "place",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // home | office | …
    label: text("label").notNull(),
    address: text("address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    station: text("station"), // station slug
    exit: text("exit"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("place_user_key_idx").on(t.userId, t.key)],
);

export const journey = pgTable(
  "journey",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // home_to_office …
    name: text("name").notNull(),
    fromPlace: text("from_place"),
    toPlace: text("to_place"),
    /** Ordered legs (walk / ride / transfer) with fixed minutes and door tips. */
    legs: jsonb("legs").notNull(),
    sheltered: boolean("sheltered").notNull().default(false),
    sort: smallint("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("journey_user_key_idx").on(t.userId, t.key)],
);

/** Owner taps: board / alight / at_platform / tap_in / tap_out / door / desk … */
export const tripEvent = pgTable(
  "trip_event",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull(),
    journeyKey: text("journey_key"),
    tripDate: text("trip_date"), // SGT yyyy-mm-dd
    kind: text("kind").notNull(),
    at: ts("at").notNull(), // moment of the tap
    station: text("station"),
    line: text("line"),
    direction: text("direction"),
    note: text("note"),
    source: text("source").notNull().default("owner"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("trip_event_client_idx").on(t.userId, t.clientId),
    index("trip_event_user_at_idx").on(t.userId, t.at),
  ],
);

/** The prediction shown/computed when the owner boarded, for accuracy. */
export const predictionCheck = pgTable(
  "prediction_check",
  {
    id: serial("id").primaryKey(),
    tripEventId: integer("trip_event_id").references(() => tripEvent.id, { onDelete: "cascade" }),
    line: text("line").notNull(),
    station: text("station").notNull(),
    direction: text("direction").notNull(),
    band: text("band").notNull(),
    boardedAt: ts("boarded_at").notNull(),
    predictedAt: ts("predicted_at"),
    kind: text("kind").notNull(),
    basis: text("basis").notNull(),
    confidence: text("confidence").notNull(),
    errorMin: real("error_min"),
    hit: boolean("hit"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("prediction_check_line_idx").on(t.line, t.station, t.boardedAt)],
);

/** Small editable settings (unstable windows, alert de-dupe…). */
export const appSetting = pgTable("app_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rateLimit = pgTable(
  "rate_limit",
  {
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.key, t.windowStart] })],
);

/* ---------------- First-party analytics ---------------- */

export const eventLog = pgTable(
  "event_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: ts("ts").notNull().defaultNow(),
    name: text("name").notNull(),
    eventId: text("event_id"),
    /** Null when analytics consent was not given (aggregate-only row). */
    deviceId: text("device_id"),
    sessionId: text("session_id"),
    aggregateOnly: boolean("aggregate_only").notNull().default(false),
    origin: text("origin").notNull().default("client"), // client | server
    userType: text("user_type").notNull().default("visitor"),
    route: text("route"),
    referrer: text("referrer"),
    props: jsonb("props").notNull().default({}),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    kolHandle: text("kol_handle"),
    viewport: text("viewport"),
    standalone: boolean("standalone"),
    language: text("language"),
    experiments: jsonb("experiments"),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    browser: text("browser"),
    os: text("os"),
    deviceType: text("device_type"),
  },
  (t) => [
    index("event_log_ts_idx").on(t.ts),
    index("event_log_name_ts_idx").on(t.name, t.ts),
    index("event_log_device_ts_idx").on(t.deviceId, t.ts),
    index("event_log_campaign_idx").on(t.utmCampaign, t.ts),
  ],
);

/** First/last touch per consenting device. */
export const device = pgTable("device", {
  id: text("id").primaryKey(),
  firstSeen: ts("first_seen").notNull().defaultNow(),
  lastSeen: ts("last_seen").notNull().defaultNow(),
  firstTouch: jsonb("first_touch"),
  lastTouch: jsonb("last_touch"),
  kolHandle: text("kol_handle"),
  referralCode: text("referral_code"),
  installedAt: ts("installed_at"),
});

export const apiMetric = pgTable(
  "api_metric",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ts: ts("ts").notNull().defaultNow(),
    route: text("route").notNull(),
    ms: real("ms").notNull(),
    status: smallint("status").notNull(),
  },
  (t) => [index("api_metric_route_ts_idx").on(t.route, t.ts)],
);

/** Practice sandbox sends (synthetic data never touches event_log). */
export const sandboxRun = pgTable("sandbox_run", {
  id: serial("id").primaryKey(),
  ranAt: ts("ran_at").notNull().defaultNow(),
  mode: text("mode").notNull(), // cron | script
  day: text("day").notNull(),
  users: integer("users").notNull().default(0),
  events: integer("events").notNull().default(0),
  requests: integer("requests").notNull().default(0),
  status: text("status").notNull(),
  error: text("error"),
});

/* ---------------- Marketing ---------------- */

export const kol = pgTable("kol", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  displayName: text("display_name").notNull(),
  platform: text("platform").notNull(), // instagram | tiktok | youtube | xhs | other
  code: text("code").notNull().unique(),
  landingVariant: text("landing_variant").notNull().default("default"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const campaign = pgTable("campaign", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  source: text("source").notNull(),
  medium: text("medium").notNull(),
  campaign: text("campaign").notNull(),
  content: text("content"),
  term: text("term"),
  campaignId: text("campaign_id"),
  landingPath: text("landing_path").notNull().default("/"),
  url: text("url").notNull(),
  kolId: integer("kol_id").references(() => kol.id, { onDelete: "set null" }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const experiment = pgTable("experiment", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  /** [{ key, weight }] */
  variants: jsonb("variants").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ---------------- Voice of customer (Neon only) ---------------- */

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  ts: ts("ts").notNull().defaultNow(),
  deviceId: text("device_id"),
  rating: smallint("rating").notNull(),
  category: text("category").notNull(),
  text: text("text"),
  route: text("route"),
  language: text("language"),
  userType: text("user_type").notNull().default("visitor"),
});

export const npsResponse = pgTable("nps_response", {
  id: serial("id").primaryKey(),
  ts: ts("ts").notNull().defaultNow(),
  deviceId: text("device_id"),
  score: smallint("score").notNull(),
  comment: text("comment"),
});

export const newsletter = pgTable("newsletter", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  consentAt: ts("consent_at").notNull(),
  confirmToken: text("confirm_token"),
  confirmedAt: ts("confirmed_at"),
  unsubscribedAt: ts("unsubscribed_at"),
  language: text("language"),
  source: text("source"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ---------------- Push ---------------- */

export const pushSubscription = pgTable("push_subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
