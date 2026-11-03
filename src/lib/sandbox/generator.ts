/**
 * Practice Sandbox: deterministic synthetic users and GA4 Measurement
 * Protocol payloads for a SEPARATE GA4 property. Every event carries
 * data_source=synthetic. Nothing here touches event_log.
 */
import { DAY, HOUR, MINUTE, SGT_OFFSET } from "../time";

export type Persona = "daily_commuter" | "tourist" | "student" | "weekend_user" | "kol_referred";
export type Acquisition = { source: string; medium: string; campaign: string; campaignId: string };
export type MpEvent = { name: string; params: Record<string, string | number>; timestamp_micros: number };
export type MpPayload = {
  client_id: string;
  timestamp_micros?: number;
  user_properties?: Record<string, { value: string }>;
  user_location?: { city?: string; region_id?: string; country_id?: string; subcontinent_id?: string; continent_id?: string };
  device?: {
    category?: string;
    language?: string;
    screen_resolution?: string;
    operating_system?: string;
    operating_system_version?: string;
    browser?: string;
    browser_version?: string;
  };
  events: MpEvent[];
};

export const ACQUISITIONS: (Acquisition & { weight: number; personas?: Persona[] })[] = [
  { source: "google", medium: "cpc", campaign: "search-mrt-times", campaignId: "gads-001", weight: 18 },
  { source: "meta", medium: "paid_social", campaign: "reels-commute", campaignId: "meta-101", weight: 14 },
  { source: "tiktok", medium: "paid_social", campaign: "tt-next-train", campaignId: "tt-201", weight: 10 },
  { source: "trainfan", medium: "kol", campaign: "kol-trainfan", campaignId: "kol-301", weight: 7, personas: ["kol_referred"] },
  { source: "sgcommuter", medium: "kol", campaign: "kol-sgcommuter", campaignId: "kol-302", weight: 5, personas: ["kol_referred"] },
  { source: "google", medium: "organic", campaign: "(organic)", campaignId: "organic", weight: 30 },
  { source: "newsletter", medium: "email", campaign: "weekly-tips", campaignId: "nl-401", weight: 6 },
  { source: "(direct)", medium: "(none)", campaign: "(direct)", campaignId: "direct", weight: 10 },
];

const PERSONAS: { key: Persona; weight: number; weekendBoost: number; returnRate: number; install: number }[] = [
  { key: "daily_commuter", weight: 40, weekendBoost: 0.3, returnRate: 0.55, install: 0.14 },
  { key: "tourist", weight: 15, weekendBoost: 1.6, returnRate: 0.1, install: 0.02 },
  { key: "student", weight: 20, weekendBoost: 0.6, returnRate: 0.35, install: 0.08 },
  { key: "weekend_user", weight: 13, weekendBoost: 2.5, returnRate: 0.2, install: 0.04 },
  { key: "kol_referred", weight: 12, weekendBoost: 1, returnRate: 0.25, install: 0.1 },
];

const DEVICES = [
  { category: "mobile", operating_system: "iOS", operating_system_version: "18.6", browser: "Safari", browser_version: "18.6", screen_resolution: "393x852", weight: 48 },
  { category: "mobile", operating_system: "Android", operating_system_version: "15", browser: "Chrome", browser_version: "141.0", screen_resolution: "412x915", weight: 37 },
  { category: "desktop", operating_system: "Windows", operating_system_version: "11", browser: "Chrome", browser_version: "141.0", screen_resolution: "1920x1080", weight: 9 },
  { category: "desktop", operating_system: "Macintosh", operating_system_version: "15.6", browser: "Safari", browser_version: "18.6", screen_resolution: "1512x982", weight: 4 },
  { category: "tablet", operating_system: "iOS", operating_system_version: "18.6", browser: "Safari", browser_version: "18.6", screen_resolution: "820x1180", weight: 2 },
];

const GEOS = [
  { city: "Singapore", region_id: "SG-01", country_id: "SG", subcontinent_id: "035", continent_id: "142", weight: 88 },
  { city: "Kuala Lumpur", region_id: "MY-14", country_id: "MY", subcontinent_id: "035", continent_id: "142", weight: 5 },
  { city: "Taipei", region_id: "TW-TPE", country_id: "TW", subcontinent_id: "030", continent_id: "142", weight: 4 },
  { city: "Hong Kong", region_id: "HK-HCW", country_id: "HK", subcontinent_id: "030", continent_id: "142", weight: 3 },
];

const STATIONS = ["outram-park", "tanjong-pagar", "tiong-bahru", "orchard", "maxwell", "shenton-way", "redhill"];
const LINES: Record<string, string> = {
  "outram-park": "TEL",
  "tanjong-pagar": "EWL",
  "tiong-bahru": "EWL",
  orchard: "TEL",
  maxwell: "TEL",
  "shenton-way": "TEL",
  redhill: "EWL",
};

/** mulberry32 PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function pick<T extends { weight: number }>(rand: () => number, items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let x = rand() * total;
  for (const item of items) if ((x -= item.weight) < 0) return item;
  return items[items.length - 1];
}

/** SGT midnight instant for "YYYY-MM-DD". */
export function dayStart(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`) - SGT_OFFSET;
}
const isWeekendDate = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

type NewUser = { clientId: string; persona: (typeof PERSONAS)[number]; acq: Acquisition; device: (typeof DEVICES)[number]; geo: (typeof GEOS)[number]; variant: string; installed: boolean };

/** The new users first seen on `date` (deterministic, no events). */
export function newUsersFor(date: string): NewUser[] {
  const rand = rng(seedOf(`new:${date}`));
  const weekend = isWeekendDate(date);
  const count = weekend ? 80 + Math.floor(rand() * 60) : 130 + Math.floor(rand() * 90);
  const users: NewUser[] = [];
  for (let i = 0; i < count; i++) {
    const persona = pick(rand, PERSONAS.map((p) => ({ ...p, weight: p.weight * (weekend ? p.weekendBoost : 1) })));
    const eligible = ACQUISITIONS.filter((a) => !a.personas || a.personas.includes(persona.key));
    const acq = persona.key === "kol_referred" ? pick(rand, ACQUISITIONS.filter((a) => a.medium === "kol")) : pick(rand, eligible.filter((a) => a.medium !== "kol"));
    const variant = rand() < 0.5 ? "control" : "countdown";
    const installBoost = variant === "countdown" ? 1.15 : 1;
    users.push({
      clientId: `${seedOf(`${date}:${i}`)}.${Math.floor(dayStart(date) / 1000)}`,
      persona,
      acq,
      device: pick(rand, DEVICES),
      geo: pick(rand, GEOS),
      variant,
      installed: rand() < persona.install * installBoost,
    });
  }
  return users;
}

function addDays(date: string, delta: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY).toISOString().slice(0, 10);
}

/** Hour-of-day weights: commuters peak 7–9 and 17–19; others midday/evening. */
function visitHour(rand: () => number, persona: Persona, weekend: boolean) {
  const peaks = persona === "daily_commuter" && !weekend ? [7.5, 8.3, 17.8, 18.4] : [11, 13, 15, 19, 21];
  return Math.min(23.5, Math.max(5.5, peaks[Math.floor(rand() * peaks.length)] + (rand() - 0.5) * 2));
}

export type SyntheticDay = { date: string; users: number; payloads: MpPayload[]; events: number };

/**
 * All MP payloads for one SGT day: new users plus returning users from the
 * previous 14 days (retention by persona). Funnel: landing → prediction
 * view → planner → install; A/B variants on the landing hero.
 */
export function generateDay(date: string): SyntheticDay {
  const weekend = isWeekendDate(date);
  const rand = rng(seedOf(`day:${date}`));
  const visitors: { user: NewUser; isNew: boolean }[] = newUsersFor(date).map((user) => ({ user, isNew: true }));
  for (let back = 1; back <= 14; back++) {
    for (const user of newUsersFor(addDays(date, -back))) {
      const decay = Math.pow(0.85, back - 1);
      const p = user.persona.returnRate * decay * (weekend ? user.persona.weekendBoost : 1) * (user.installed ? 1.6 : 1);
      if (rand() < Math.min(0.9, p * 0.6)) visitors.push({ user, isNew: false });
    }
  }

  const payloads: MpPayload[] = [];
  let events = 0;
  const start = dayStart(date);
  for (const { user, isNew } of visitors) {
    const t0 = start + visitHour(rand, user.persona.key, weekend) * HOUR;
    const sessionId = String(Math.floor(t0 / 1000));
    const station = STATIONS[Math.floor(rand() * STATIONS.length)];
    const common = {
      session_id: sessionId,
      data_source: "synthetic",
      language: user.geo.country_id === "TW" || user.geo.country_id === "HK" ? "zh-Hant" : "en",
      user_type: "visitor",
      standalone: user.installed && !isNew ? "yes" : "no",
      persona: user.persona.key,
      campaign: user.acq.campaign,
      ...(user.acq.medium === "kol" ? { kol_handle: user.acq.source } : {}),
    };
    const evs: MpEvent[] = [];
    let t = t0;
    const push = (name: string, params: Record<string, string | number> = {}, gapSec = 20) => {
      t += gapSec * 1000 * (0.5 + rand());
      evs.push({ name, timestamp_micros: Math.round(t * 1000), params: { ...common, engagement_time_msec: Math.round(gapSec * 1000), ...params } });
    };
    const utm = new URLSearchParams({ utm_source: user.acq.source, utm_medium: user.acq.medium, utm_campaign: user.acq.campaign, utm_id: user.acq.campaignId });
    const landing = user.acq.medium === "kol" ? `/k/${user.acq.source}` : "/";
    push("page_view", { page_location: `https://mrt.example/${landing.replace(/^\//, "")}${isNew ? `?${utm}` : ""}`, page_type: user.acq.medium === "kol" ? "kol" : "landing" }, 1);
    if (isNew && user.acq.medium === "kol") push("kol_landing", { kol_handle: user.acq.source, code_used: rand() < 0.3 ? 1 : 0 }, 1);
    if (isNew && !["organic", "(none)"].includes(user.acq.medium)) push("campaign_landing", { source: user.acq.source, medium: user.acq.medium }, 1);
    if (isNew) push("experiment_exposure", { experiment_id: "landing_hero", variant: user.variant }, 1);
    if (!isNew && user.installed) push("standalone_open", {}, 1);
    if (rand() < 0.75) {
      push("station_view", { station, line: LINES[station] });
      push("prediction_view", { station, line: LINES[station], confidence: rand() < 0.4 ? "high" : rand() < 0.6 ? "medium" : "low" });
      const plannerRate = 0.38 * (user.variant === "countdown" ? 1.2 : 1) * (user.persona.key === "daily_commuter" ? 1.4 : 1);
      if (rand() < plannerRate) {
        push("planner_query", { journey_type: "public", mode: rand() < 0.6 ? "depart" : "list", transfers: Math.floor(rand() * 2) }, 30);
        if (isNew && user.installed) {
          push("install_prompt_shown", { platform: user.device.operating_system === "iOS" ? "ios" : "android" }, 10);
          push("app_installed", { platform: user.device.operating_system === "iOS" ? "ios" : "android" }, 15);
        }
      }
      if (rand() < 0.05) push("share", { method: "web_share", content_type: "station" });
      if (rand() < 0.02) push("newsletter_signup", { double_opt_in: 0 });
      if (rand() < 0.03) push("feedback_submit", { rating: 3 + Math.floor(rand() * 3), category: "accuracy" });
    }
    events += evs.length;
    for (let i = 0; i < evs.length; i += 25)
      payloads.push({
        client_id: user.clientId,
        user_properties: { persona: { value: user.persona.key }, data_source: { value: "synthetic" } },
        user_location: { city: user.geo.city, region_id: user.geo.region_id, country_id: user.geo.country_id, subcontinent_id: user.geo.subcontinent_id, continent_id: user.geo.continent_id },
        device: {
          category: user.device.category,
          language: common.language === "zh-Hant" ? "zh-tw" : "en-sg",
          screen_resolution: user.device.screen_resolution,
          operating_system: user.device.operating_system,
          operating_system_version: user.device.operating_system_version,
          browser: user.device.browser,
          browser_version: user.device.browser_version,
        },
        events: evs.slice(i, i + 25),
      });
  }
  return { date, users: visitors.length, payloads, events };
}

/** MP accepts timestamps up to 72 h back; keep a safety margin and drop future events. */
export const MP_MAX_BACKDATE_MS = 72 * HOUR;
export function clampToMpWindow(payloads: MpPayload[], now: number, marginMs = 30 * MINUTE): MpPayload[] {
  const oldest = (now - MP_MAX_BACKDATE_MS + marginMs) * 1000;
  const newest = now * 1000;
  return payloads
    .map((p) => ({ ...p, events: p.events.filter((e) => e.timestamp_micros >= oldest && e.timestamp_micros <= newest) }))
    .filter((p) => p.events.length > 0);
}
