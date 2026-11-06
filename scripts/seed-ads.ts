/**
 * Seed the three self-promotional house campaigns (no third-party brands).
 * Idempotent: campaigns upsert by slug, creatives by `ref`, so re-running
 * updates copy without creating duplicates or breaking report history.
 *
 *   pnpm ads:seed               # uses DATABASE_URL from .env.local / .env (run by Hermes)
 *   pnpm ads:seed --dry-run     # print what would be written
 */
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "../src/lib/db/schema";
import type { AdTargeting } from "../src/lib/db/schema";
import type { AdFormat } from "../src/lib/ads/formats";

type Campaign = {
  slug: string;
  name: string;
  objective: "awareness" | "traffic" | "conversion";
  dailyBudgetSgd: number;
  bidModel: "cpm" | "cpc";
  bidAmountSgd: number;
  targeting: AdTargeting;
  creatives: {
    ref: string;
    format: AdFormat;
    headline: string;
    primaryText?: string;
    description?: string;
    imageUrl?: string;
    ctaLabel: string;
    destinationUrl: string;
    weight?: number;
  }[];
};

export const HOUSE_CAMPAIGNS: Campaign[] = [
  {
    slug: "install-mrt-time",
    name: "Install MRT Time",
    objective: "conversion",
    dailyBudgetSgd: 5,
    bidModel: "cpm",
    bidAmountSgd: 4,
    targeting: { devices: ["mobile", "tablet"] },
    creatives: [
      {
        ref: "install-story-1",
        format: "meta_story",
        headline: "Your next train, one tap from your home screen",
        primaryText: "Add MRT Time to your home screen: live board times, works offline.",
        imageUrl: "/opengraph-image",
        ctaLabel: "Install",
        destinationUrl: "/settings#install",
      },
      {
        ref: "install-display-1",
        format: "google_display",
        headline: "Install MRT Time — next train in one tap",
        description: "Free, no sign-up. Board times from real platform readings, even offline.",
        imageUrl: "/opengraph-image",
        ctaLabel: "Install",
        destinationUrl: "/settings#install",
      },
    ],
  },
  {
    slug: "join-newsletter",
    name: "Join the newsletter",
    objective: "conversion",
    dailyBudgetSgd: 3,
    bidModel: "cpc",
    bidAmountSgd: 0.3,
    targeting: {},
    creatives: [
      {
        ref: "newsletter-feed-1",
        format: "meta_feed",
        headline: "Weekly MRT tips in your inbox",
        primaryText: "Which door is fastest at Outram Park? One short email a week: accuracy updates and commute tips.",
        imageUrl: "/opengraph-image",
        ctaLabel: "Sign up",
        destinationUrl: "/#newsletter",
      },
    ],
  },
  {
    slug: "accuracy-report",
    name: "Read the accuracy report",
    objective: "traffic",
    dailyBudgetSgd: 2,
    bidModel: "cpc",
    bidAmountSgd: 0.2,
    targeting: {},
    creatives: [
      {
        ref: "accuracy-search-1",
        format: "google_search_text",
        headline: "How Accurate Is MRT Time? | Live Accuracy Report",
        description: "See how often next-train predictions land within ±1 min, by line, station and hour. Updated daily.",
        ctaLabel: "Learn more",
        destinationUrl: "/accuracy",
      },
    ],
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- works with any drizzle Postgres driver (Neon, PGlite)
type AnyPg = PgDatabase<PgQueryResultHKT, any>;

export async function seedAds(db: AnyPg) {
  let campaigns = 0;
  let creatives = 0;
  for (const c of HOUSE_CAMPAIGNS) {
    const values = {
      slug: c.slug,
      name: c.name,
      advertiser: "MRT Time",
      objective: c.objective,
      dailyBudgetSgd: c.dailyBudgetSgd,
      bidModel: c.bidModel,
      bidAmountSgd: c.bidAmountSgd,
      targeting: c.targeting,
    };
    const [row] = await db
      .insert(schema.adCampaign)
      .values(values)
      .onConflictDoUpdate({ target: schema.adCampaign.slug, set: { ...values, updatedAt: sql`now()` } })
      .returning({ id: schema.adCampaign.id });
    campaigns++;
    for (const cr of c.creatives) {
      const v = {
        campaignId: row.id,
        ref: cr.ref,
        format: cr.format,
        headline: cr.headline,
        primaryText: cr.primaryText ?? null,
        description: cr.description ?? null,
        imageUrl: cr.imageUrl ?? null,
        ctaLabel: cr.ctaLabel,
        destinationUrl: cr.destinationUrl,
        weight: cr.weight ?? 1,
      };
      await db
        .insert(schema.adCreative)
        .values(v)
        .onConflictDoUpdate({ target: schema.adCreative.ref, set: { ...v, updatedAt: sql`now()` } });
      creatives++;
    }
  }
  return { campaigns, creatives };
}

async function main() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  if (process.argv.includes("--dry-run")) {
    for (const c of HOUSE_CAMPAIGNS) console.log(`${c.slug}: ${c.creatives.map((cr) => cr.format).join(", ")}`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  const { neon } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-http");
  const db = drizzle(neon(process.env.DATABASE_URL), { schema });
  const result = await seedAds(db as unknown as AnyPg);
  console.log(`Upserted ${result.campaigns} house campaigns and ${result.creatives} creatives.`);
}

if (process.argv[1]?.endsWith("seed-ads.ts"))
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
