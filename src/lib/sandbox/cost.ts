/**
 * Synthetic ad cost in GA4 cost-data-import format. Required: utm_source,
 * utm_medium, date (YYYY-MM-DD), currency with cost; recommended utm_id and
 * utm_campaign; metrics impressions/clicks/cost. utm_term/utm_content are
 * not allowed. One row per source+medium+campaign+date.
 */
import { rng, ACQUISITIONS } from "./generator";

export const COST_COLUMNS = ["utm_source", "utm_medium", "utm_campaign", "utm_id", "date", "currency", "impressions", "clicks", "cost"] as const;

const PAID = ACQUISITIONS.filter((a) => ["cpc", "paid_social", "kol"].includes(a.medium));

export function costRows(dates: string[], currency = "SGD") {
  const rows: Record<(typeof COST_COLUMNS)[number], string>[] = [];
  for (const date of dates) {
    const rand = rng(Number(date.replace(/-/g, "")));
    for (const a of PAID) {
      const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      const base = a.medium === "cpc" ? 9000 : a.medium === "kol" ? 4000 : 15000;
      const impressions = Math.round(base * (weekend ? 0.7 : 1) * (0.8 + rand() * 0.4));
      const ctr = a.medium === "cpc" ? 0.045 : a.medium === "kol" ? 0.03 : 0.012;
      const clicks = Math.round(impressions * ctr * (0.85 + rand() * 0.3));
      const cpc = a.medium === "cpc" ? 0.55 : a.medium === "kol" ? 0.9 : 0.35;
      const cost = (clicks * cpc * (0.9 + rand() * 0.2)).toFixed(2);
      rows.push({
        utm_source: a.source,
        utm_medium: a.medium,
        utm_campaign: a.campaign,
        utm_id: a.campaignId,
        date,
        currency,
        impressions: String(impressions),
        clicks: String(clicks),
        cost,
      });
    }
  }
  return rows;
}

export function costCsv(dates: string[], currency = "SGD") {
  const rows = costRows(dates, currency);
  return [COST_COLUMNS.join(","), ...rows.map((r) => COST_COLUMNS.map((c) => r[c]).join(","))].join("\n") + "\n";
}

/** The last `n` SGT dates ending yesterday (cost import rejects future dates). */
export function recentDates(now: number, n: number) {
  const out: string[] = [];
  for (let i = n; i >= 1; i--) out.push(new Date(now + 8 * 3_600_000 - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}
