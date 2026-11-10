import Link from "next/link";
import { asc, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { dbConfigured, getDb } from "@/lib/db";
import { adCampaign, adCreative } from "@/lib/db/schema";
import { adReport, AD_REPORT_DIMENSIONS } from "@/lib/server/ads";
import { parseRange } from "@/lib/server/admin";
import { adSenseFromEnv } from "@/lib/ads/adsense";
import { AD_BID_MODELS, AD_DEVICES, AD_OBJECTIVES, AD_TIME_BANDS, isAdFormat } from "@/lib/ads/formats";
import { LINE_CODE_LIST, STATIONS } from "@/lib/network/data";
import { appUrl } from "@/lib/seo";
import { sgtDate } from "@/lib/time";
import { Card, DataTable } from "@/components/admin/charts";
import { RangeForm } from "@/components/admin/range-form";
import { CreativeEditor, type EditableCreative } from "@/components/ads/creative-editor";
import { HouseAd } from "@/components/ads/house-ad";
import { saveAdCampaign, saveAdCreative } from "../actions";

type SP = Record<string, string | string[] | undefined>;

export default async function AdsAdmin({ searchParams }: { searchParams: Promise<SP> }) {
  const [session, { t, locale }] = await Promise.all([getSession(), getT()]);
  if (!dbConfigured()) return <p className="text-muted">{t("common.notConfigured")}</p>;
  const sp = await searchParams;
  const range = parseRange(sp.from as string | undefined, sp.to as string | undefined);
  const owner = session?.user.role === "owner";
  const db = getDb();
  const [campaigns, creatives, ...reports] = await Promise.all([
    db.select().from(adCampaign).orderBy(desc(adCampaign.createdAt)).limit(100),
    db.select().from(adCreative).orderBy(asc(adCreative.campaignId), asc(adCreative.id)).limit(500),
    ...AD_REPORT_DIMENSIONS.map((by) => adReport(db, range, by).catch(() => [])),
  ]);
  const editCampaign = campaigns.find((c) => String(c.id) === sp.campaign);
  const editCreative = creatives.find((c) => String(c.id) === sp.creative);
  const adsense = adSenseFromEnv();
  const origin = appUrl();
  const qs = `from=${range.fromDate}&to=${range.toDate}`;
  const tg = editCampaign?.targeting ?? {};
  const checks = (name: keyof typeof tg, options: readonly string[], labels?: Record<string, string>) => (
    <fieldset className="text-xs text-muted">
      <legend>{t(`admin.ads.${name}` as "admin.ads.stations")}</legend>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1 text-ink">
            <input type="checkbox" name={name} value={o} defaultChecked={(tg[name] ?? []).includes(o)} /> {labels?.[o] ?? o}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const field = (name: string, label: string, value: string | number | undefined, type = "text", extra: Record<string, string | number> = {}) => (
    <label className="text-xs text-muted">
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} className="field mt-1 text-sm" {...extra} />
    </label>
  );
  const select = (name: string, label: string, options: readonly string[], value?: string) => (
    <label className="text-xs text-muted">
      {label}
      <select name={name} defaultValue={value} className="field mt-1 text-sm">
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {t("admin.ads.adsense", { state: adsense ? t("admin.ads.adsenseOn", { client: adsense.client }) : t("admin.ads.adsenseOff") })}
      </p>

      <RangeForm t={t} from={range.fromDate} to={range.toDate} />
      {AD_REPORT_DIMENSIONS.map((by, i) => (
        <Card key={by} title={`${t("admin.ads.report")} · ${t("admin.ads.by", { dim: by })}`} csv={`/api/admin/ads-report?by=${by}&${qs}`}>
          <DataTable rows={reports[i]} />
        </Card>
      ))}

      {owner && (
        <Card title={t(editCampaign ? "admin.ads.editCampaign" : "admin.ads.newCampaign")}>
          <form action={saveAdCampaign} key={editCampaign?.id ?? "new"} className="grid gap-2 sm:grid-cols-4">
            {editCampaign && <input type="hidden" name="id" value={editCampaign.id} />}
            {field("name", t("admin.ads.name"), editCampaign?.name, "text", { required: "required", maxLength: 80 })}
            {field("slug", t("admin.ads.slug"), editCampaign?.slug, "text", { required: "required", pattern: "[a-z0-9][a-z0-9_\\-]{1,47}" })}
            {field("advertiser", t("admin.ads.advertiser"), editCampaign?.advertiser ?? "MRT Time", "text", { required: "required", maxLength: 60 })}
            {select("objective", t("admin.ads.objective"), AD_OBJECTIVES, editCampaign?.objective)}
            {select("status", t("admin.ads.status"), ["active", "paused", "ended"], editCampaign?.status)}
            {field("start", t("admin.ads.start"), sgtDate(editCampaign ? new Date(editCampaign.startAt).getTime() : Date.now()), "date", { required: "required" })}
            {field("end", t("admin.ads.end"), editCampaign?.endAt ? sgtDate(new Date(editCampaign.endAt).getTime() - 1) : "", "date")}
            {field("dailyBudgetSgd", t("admin.ads.budget"), editCampaign?.dailyBudgetSgd ?? 5, "number", { min: 0, step: "0.01", required: "required" })}
            {select("bidModel", t("admin.ads.bidModel"), AD_BID_MODELS, editCampaign?.bidModel)}
            {field("bidAmountSgd", t("admin.ads.bid"), editCampaign?.bidAmountSgd ?? 3, "number", { min: 0, step: "0.01", required: "required" })}
            <div className="grid gap-2 sm:col-span-4">
              <p className="text-xs font-semibold">{t("admin.ads.targeting")}</p>
              {checks("stations", STATIONS.map((s) => s.slug), Object.fromEntries(STATIONS.map((s) => [s.slug, s.name[locale]])))}
              {checks("lines", [...LINE_CODE_LIST])}
              {checks("languages", ["en", "zh-Hant"])}
              {checks("timeBands", AD_TIME_BANDS)}
              {checks("devices", AD_DEVICES)}
            </div>
            <button className="btn btn-primary sm:col-span-4">{t("admin.ads.save")}</button>
          </form>
        </Card>
      )}

      {owner && campaigns.length > 0 && (
        <Card title={t(editCreative ? "admin.ads.editCreative" : "admin.ads.newCreative")}>
          <CreativeEditor
            key={editCreative?.id ?? "new"}
            campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
            advertiserFor={Object.fromEntries(campaigns.map((c) => [c.id, c.advertiser]))}
            origin={origin}
            initial={editCreative && isAdFormat(editCreative.format) ? ({ ...editCreative, format: editCreative.format } as EditableCreative) : undefined}
            action={saveAdCreative}
          />
        </Card>
      )}

      <Card title={t("admin.ads.campaigns")} csv={`/api/admin/export?table=ad_event&${qs}`}>
        {!campaigns.length && <p className="text-sm text-muted">{t("admin.ads.none")}</p>}
        <ul className="divide-y divide-line">
          {campaigns.map((c) => (
            <li key={c.id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.name}</span>
                <span className="chip bg-panel-2 text-muted">{c.slug}</span>
                <span className="chip bg-panel-2 text-muted">
                  {c.objective} · {c.status} · {c.bidModel.toUpperCase()} S${c.bidAmountSgd} · S${c.dailyBudgetSgd}/day
                </span>
                {owner && (
                  <Link className="ml-auto text-xs text-accent underline" href={`/admin/ads?campaign=${c.id}&${qs}`}>
                    {t("admin.ads.edit")}
                  </Link>
                )}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {creatives
                  .filter((cr) => cr.campaignId === c.id && isAdFormat(cr.format))
                  .map((cr) => (
                    <div key={cr.id} className="w-56 shrink-0 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted">
                        #{cr.id} · {cr.format} · w{cr.weight} · {cr.status}
                        {owner && (
                          <Link className="ml-auto text-accent underline" href={`/admin/ads?creative=${cr.id}&${qs}`}>
                            {t("admin.ads.edit")}
                          </Link>
                        )}
                      </div>
                      <div className="h-[180px] overflow-hidden rounded border border-line">
                        <div className="flex h-[300px] w-[166%] origin-top-left scale-[0.6] items-start justify-center">
                          <HouseAd
                            preview
                            locale={locale}
                            ad={{
                              id: cr.id,
                              format: cr.format as EditableCreative["format"],
                              advertiser: c.advertiser,
                              headline: cr.headline,
                              primaryText: cr.primaryText,
                              description: cr.description,
                              image: cr.imageUrl || cr.imageData,
                              ctaLabel: cr.ctaLabel,
                              displayHost: new URL(cr.destinationUrl, origin).hostname,
                              clickUrl: "#",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
