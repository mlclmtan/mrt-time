import type { T } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { formatDateRange } from "@/lib/format";

/**
 * GET form → ?from=YYYY-MM-DD&to=YYYY-MM-DD (SGT dates). Native date
 * inputs follow the browser locale (often MM/DD), so the chosen range is
 * also spelled out unambiguously next to them.
 */
export async function RangeForm({ t, from, to }: { t: T; from: string; to: string }) {
  const locale = await getLocale();
  return (
    <form className="flex flex-wrap items-end gap-2 text-sm">
      <label className="text-muted">
        {t("common.from")}
        <input type="date" name="from" defaultValue={from} className="field mt-1" />
      </label>
      <label className="text-muted">
        {t("common.to")}
        <input type="date" name="to" defaultValue={to} className="field mt-1" />
      </label>
      <button className="btn btn-secondary py-2">{t("common.apply")}</button>
      <output className="tabular basis-full pb-1 text-xs text-muted sm:basis-auto sm:pb-2.5">
        {t("admin.showing", { range: formatDateRange(from, to, locale) })}
      </output>
    </form>
  );
}
