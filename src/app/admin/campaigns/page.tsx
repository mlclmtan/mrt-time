import { desc } from "drizzle-orm";
import QRCode from "qrcode";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { dbConfigured, getDb } from "@/lib/db";
import { campaign } from "@/lib/db/schema";
import { campaignPerformanceQuery, runRows } from "@/lib/analytics/aggregates";
import { parseRange } from "@/lib/server/admin";
import { Card, DataTable } from "@/components/admin/charts";
import { RangeForm } from "@/components/admin/range-form";
import { createCampaign } from "../actions";

export default async function Campaigns({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, { t }] = await Promise.all([getSession(), getT()]);
  if (!dbConfigured()) return <p className="text-muted">{t("common.notConfigured")}</p>;
  const sp = await searchParams;
  const range = parseRange(sp.from as string | undefined, sp.to as string | undefined);
  const db = getDb();
  const [rows, perf] = await Promise.all([
    db.select().from(campaign).orderBy(desc(campaign.createdAt)).limit(50),
    runRows<Record<string, unknown>>(db, campaignPerformanceQuery(range)).catch(() => []),
  ]);
  const withQr = await Promise.all(
    rows.map(async (c) => ({
      ...c,
      svg: await QRCode.toString(c.url, { type: "svg", margin: 1, color: { dark: "#000000", light: "#ffffff" } }),
      png: await QRCode.toDataURL(c.url, { margin: 1, width: 512 }),
    })),
  );
  const owner = session?.user.role === "owner";
  const fields: [string, string, boolean][] = [
    ["name", t("admin.campaign.name"), false],
    ["source", t("admin.campaign.source"), true],
    ["medium", t("admin.campaign.medium"), true],
    ["campaign", t("admin.campaign.campaign"), true],
    ["content", t("admin.campaign.content"), false],
    ["term", t("admin.campaign.term"), false],
    ["campaignId", t("admin.campaign.id"), false],
    ["landingPath", t("admin.campaign.landing"), false],
  ];
  return (
    <div className="space-y-4">
      {owner && (
        <form action={createCampaign} className="panel grid gap-2 p-4 sm:grid-cols-4">
          {fields.map(([name, label, required]) => (
            <label key={name} className="text-xs text-muted">
              {label}
              <input name={name} required={required} defaultValue={name === "landingPath" ? "/" : ""} className="field mt-1 text-sm" />
            </label>
          ))}
          <button className="btn btn-primary sm:col-span-4">{t("common.create")}</button>
        </form>
      )}
      <Card title={t("admin.campaigns")} csv={`/api/admin/export?table=campaign&from=${range.fromDate}&to=${range.toDate}`}>
        <ul className="divide-y divide-line">
          {withQr.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-4 py-3 text-sm">
              <div
                className="h-20 w-20 shrink-0 overflow-hidden rounded bg-white"
                // QR SVG generated server-side from our own URL.
                dangerouslySetInnerHTML={{ __html: c.svg }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{c.name}</div>
                <div className="truncate text-xs text-muted">{c.url}</div>
              </div>
              <a className="text-xs text-accent underline" download={`qr-${c.campaign}.svg`} href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}`}>
                SVG
              </a>
              <a className="text-xs text-accent underline" download={`qr-${c.campaign}.png`} href={c.png}>
                PNG
              </a>
            </li>
          ))}
        </ul>
      </Card>
      <RangeForm t={t} from={range.fromDate} to={range.toDate} />
      <Card title={t("admin.campaign.performance")}>
        <DataTable rows={perf} />
      </Card>
    </div>
  );
}
