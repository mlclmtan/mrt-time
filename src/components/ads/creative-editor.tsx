"use client";
import { useState } from "react";
import { AD_FORMATS, MAX_IMAGE_BYTES, displayHost, withAdUtm, type AdFormat } from "@/lib/ads/formats";
import { useI18n } from "../i18n";
import { HouseAd } from "./house-ad";

export type EditableCreative = {
  id?: number;
  campaignId: number;
  format: AdFormat;
  headline: string;
  primaryText: string | null;
  description: string | null;
  imageUrl: string | null;
  imageData: string | null;
  ctaLabel: string;
  destinationUrl: string;
  weight: number;
  status: string;
};

/** Create/edit a creative with a live preview in every format. */
export function CreativeEditor({
  campaigns,
  initial,
  origin,
  advertiserFor,
  action,
}: {
  campaigns: { id: number; name: string; slug: string }[];
  initial?: EditableCreative;
  origin: string;
  advertiserFor: Record<number, string>;
  action: (form: FormData) => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [c, setC] = useState<EditableCreative>(
    initial ?? {
      campaignId: campaigns[0]?.id ?? 0,
      format: "meta_feed",
      headline: "",
      primaryText: "",
      description: "",
      imageUrl: "",
      imageData: "",
      ctaLabel: "Learn more",
      destinationUrl: "/",
      weight: 1,
      status: "active",
    },
  );
  const [imageError, setImageError] = useState(false);
  const set = <K extends keyof EditableCreative>(k: K, v: EditableCreative[K]) => setC((x) => ({ ...x, [k]: v }));
  const campaign = campaigns.find((x) => x.id === Number(c.campaignId));
  const finalUrl = withAdUtm(c.destinationUrl || "/", { format: c.format, campaignSlug: campaign?.slug ?? "", creativeId: c.id ?? 0 }, origin);
  const ad = (format: AdFormat) => ({
    id: c.id ?? 0,
    format,
    advertiser: advertiserFor[Number(c.campaignId)] ?? "MRT Time",
    headline: c.headline || t("admin.ads.headline"),
    primaryText: c.primaryText || null,
    description: c.description || null,
    image: c.imageUrl || c.imageData || null,
    ctaLabel: c.ctaLabel,
    displayHost: displayHost(c.destinationUrl || "/", origin),
    clickUrl: "#",
  });

  const onFile = (file: File | undefined) => {
    setImageError(false);
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) return setImageError(true);
    const reader = new FileReader();
    reader.onload = () => {
      set("imageData", String(reader.result));
      set("imageUrl", "");
    };
    reader.readAsDataURL(file);
  };

  const text = (k: "headline" | "primaryText" | "description" | "imageUrl" | "ctaLabel" | "destinationUrl", label: string, max: number, area = false) => (
    <label className="text-xs text-muted">
      {label}
      {area ? (
        <textarea name={k} maxLength={max} value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="field mt-1 text-sm" rows={2} />
      ) : (
        <input name={k} maxLength={max} value={c[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="field mt-1 text-sm" />
      )}
    </label>
  );

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-2">
      <div className="grid content-start gap-2">
        {c.id && <input type="hidden" name="id" value={c.id} />}
        <input type="hidden" name="imageData" value={c.imageUrl ? "" : (c.imageData ?? "")} />
        <label className="text-xs text-muted">
          {t("admin.ads.campaign")}
          <select name="campaignId" value={c.campaignId} onChange={(e) => set("campaignId", Number(e.target.value))} className="field mt-1 text-sm">
            {campaigns.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          {t("admin.ads.format")}
          <select name="format" value={c.format} onChange={(e) => set("format", e.target.value as AdFormat)} className="field mt-1 text-sm">
            {AD_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        {text("headline", t("admin.ads.headline"), 90)}
        {text("primaryText", t("admin.ads.primaryText"), 300, true)}
        {text("description", t("admin.ads.description"), 200, true)}
        {text("imageUrl", t("admin.ads.imageUrl"), 500)}
        <label className="text-xs text-muted">
          {t("admin.ads.upload")}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => onFile(e.target.files?.[0])} className="field mt-1 text-sm" />
        </label>
        {imageError && <p className="text-xs text-bad">{t("admin.ads.imageTooBig")}</p>}
        {text("ctaLabel", t("admin.ads.cta"), 24)}
        {text("destinationUrl", t("admin.ads.destination"), 500)}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            {t("admin.ads.weight")}
            <input name="weight" type="number" min={0} max={100} value={c.weight} onChange={(e) => set("weight", Number(e.target.value))} className="field mt-1 text-sm" />
          </label>
          <label className="text-xs text-muted">
            {t("admin.ads.status")}
            <select name="status" value={c.status} onChange={(e) => set("status", e.target.value)} className="field mt-1 text-sm">
              <option value="active">active</option>
              <option value="paused">paused</option>
            </select>
          </label>
        </div>
        <p className="text-xs break-all text-muted">
          {t("admin.ads.finalUrl")}: <span className="text-ink">{finalUrl ?? "—"}</span>
        </p>
        <button className="btn btn-primary">{t("admin.ads.save")}</button>
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t("admin.ads.preview")}</h3>
        <div className="flex h-[300px] items-center justify-center rounded-lg border border-line p-2">
          <HouseAd ad={ad(c.format)} locale={locale} preview />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {AD_FORMATS.filter((f) => f !== c.format).map((f) => (
            <div key={f} className="space-y-1">
              <div className="text-[10px] text-muted">{f}</div>
              <div className="h-[180px] overflow-hidden rounded border border-line">
                <div className="flex h-[300px] w-[166%] origin-top-left scale-[0.6] items-start justify-center">
                  <HouseAd ad={ad(f)} locale={locale} preview />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </form>
  );
}
